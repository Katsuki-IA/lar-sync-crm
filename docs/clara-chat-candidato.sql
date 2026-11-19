-- Chat web público da Clara (/chat) — SQL CANDIDATO, NÃO APLICADO.
-- Aplicação manual pela responsável após revisão. Rollback no fim do arquivo.
--
-- Decisões:
-- * Nada aqui cria crm_leads/lead: crm_leads.telefone é NOT NULL e há gatilhos
--   de envio/fila em crm_leads e lead (crm_enqueue_new_lead_if_enabled,
--   hub_capture_queue_intake, crm_dispatch_on_qualified, blocked_send_alert_*,
--   enqueue_external_qualification, kp_on_takeover...). O contato informado no
--   chat fica pendente na própria sessão; cadastro no CRM é fase posterior.
-- * Sessão anônima nunca é vinculada a lead existente por e-mail/telefone.
-- * Somente service_role executa os wrappers; tabelas com RLS e sem grants.
-- * Idempotência por (sessão, request_id); lease por sessão impede duas
--   gerações simultâneas; a abertura (greeting) ocorre no máximo uma vez.

-- === pglite-core-begin ===
create schema if not exists private;

create table private.web_chat_config (
  empresa_id bigint primary key references public.empresa_dados(id),
  enabled boolean not null default false,
  assistant_name text not null default 'Clara' check (length(assistant_name) between 1 and 40),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  avatar_fallback text not null default 'C' check (length(avatar_fallback) between 1 and 2),
  model text not null default 'gpt-4.1',
  temperature numeric not null default 0.5 check (temperature between 0 and 1),
  prompt_ids bigint[] not null default '{55,56}',
  updated_at timestamptz not null default now()
);

create table private.web_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  empresa_id bigint not null references private.web_chat_config(empresa_id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  greeted_at timestamptz,
  lease_request uuid,
  lease_until timestamptz,
  contact jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index on private.web_chat_sessions (ip_hash, created_at);

create table private.web_chat_requests (
  session_id uuid not null references private.web_chat_sessions(id) on delete cascade,
  request_id uuid not null,
  kind text not null check (kind in ('greeting','message')),
  status text not null check (status in ('pending','done','failed')),
  ip_hash text not null,
  user_message_id bigint,
  reply_message_id bigint,
  attempts int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, request_id)
);
create index on private.web_chat_requests (ip_hash, created_at);
create unique index web_chat_one_greeting on private.web_chat_requests (session_id) where kind = 'greeting';

create table private.web_chat_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references private.web_chat_sessions(id) on delete cascade,
  request_id uuid not null,
  role text not null check (role in ('user','assistant')),
  content text not null check (length(content) between 1 and 8000),
  created_at timestamptz not null default now(),
  unique (session_id, request_id, role)
);
create index on private.web_chat_messages (session_id, id);

alter table private.web_chat_config enable row level security;
alter table private.web_chat_sessions enable row level security;
alter table private.web_chat_requests enable row level security;
alter table private.web_chat_messages enable row level security;
revoke all on private.web_chat_config, private.web_chat_sessions,
  private.web_chat_requests, private.web_chat_messages
  from public, anon, authenticated, service_role;

-- Histórico (mais recentes, em ordem cronológica).
create function private.web_chat_history(p_session uuid, p_limit int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role,
    'content', m.content, 'created_at', m.created_at) order by m.id), '[]'::jsonb)
  from (select * from private.web_chat_messages
        where session_id = p_session order by id desc limit greatest(1, least(p_limit, 200))) m
$$;

-- Abre (ou cria) a sessão. Nunca retorna dados de outra sessão.
create function private.web_chat_open(p_empresa bigint, p_token_hash text, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cfg private.web_chat_config; v_s private.web_chat_sessions; v_recent int;
begin
  select * into v_cfg from private.web_chat_config where empresa_id = p_empresa;
  if not found or not v_cfg.enabled then return jsonb_build_object('status','disabled'); end if;
  select * into v_s from private.web_chat_sessions where token_hash = p_token_hash and empresa_id = p_empresa;
  if not found then
    select count(*) into v_recent from private.web_chat_sessions
      where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if v_recent >= 10 then return jsonb_build_object('status','rate_limited'); end if;
    insert into private.web_chat_sessions (empresa_id, token_hash, ip_hash)
      values (p_empresa, p_token_hash, p_ip_hash) returning * into v_s;
  else
    update private.web_chat_sessions set last_seen_at = now() where id = v_s.id;
  end if;
  return jsonb_build_object('status','ok',
    'config', jsonb_build_object('assistant_name', v_cfg.assistant_name,
      'avatar_url', v_cfg.avatar_url, 'avatar_fallback', v_cfg.avatar_fallback),
    'greeted', v_s.greeted_at is not null,
    'messages', private.web_chat_history(v_s.id, 100));
end $$;

-- Inicia uma geração. Retorna:
--  proceed  -> o chamador detém o lease e deve gerar e chamar finish
--  done     -> requisição já concluída (retry); devolve a resposta salva
--  busy     -> outra geração em andamento nesta sessão
--  rate_limited / disabled / no_session / invalid
create function private.web_chat_begin(p_empresa bigint, p_token_hash text, p_ip_hash text,
  p_request uuid, p_kind text, p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cfg private.web_chat_config; v_s private.web_chat_sessions;
  v_r private.web_chat_requests; v_msg bigint; v_n int; v_text text := btrim(coalesce(p_text,''));
begin
  if p_request is null or p_kind not in ('greeting','message') then
    return jsonb_build_object('status','invalid'); end if;
  if p_kind = 'message' and (length(v_text) < 1 or length(v_text) > 2000) then
    return jsonb_build_object('status','invalid'); end if;
  select * into v_cfg from private.web_chat_config where empresa_id = p_empresa;
  if not found or not v_cfg.enabled then return jsonb_build_object('status','disabled'); end if;
  select * into v_s from private.web_chat_sessions
    where token_hash = p_token_hash and empresa_id = p_empresa for update;
  if not found then return jsonb_build_object('status','no_session'); end if;

  select * into v_r from private.web_chat_requests where session_id = v_s.id and request_id = p_request;
  if found then
    if v_r.kind <> p_kind then return jsonb_build_object('status','invalid'); end if;
    if v_r.status = 'done' then
      return jsonb_build_object('status','done', 'reply',
        (select jsonb_build_object('id', id, 'role', role, 'content', content, 'created_at', created_at)
           from private.web_chat_messages where id = v_r.reply_message_id));
    end if;
  end if;

  if v_s.lease_until is not null and v_s.lease_until > now() then
    return jsonb_build_object('status','busy'); end if;

  if p_kind = 'greeting' then
    if v_s.greeted_at is not null then return jsonb_build_object('status','done','reply',null); end if;
    -- Outra requisição de abertura com id diferente: reaproveita a existente.
    if v_r.request_id is null and exists (select 1 from private.web_chat_requests
         where session_id = v_s.id and kind = 'greeting') then
      select * into v_r from private.web_chat_requests where session_id = v_s.id and kind = 'greeting';
      p_request := v_r.request_id;
    end if;
  end if;

  if v_r.request_id is null then
    select count(*) into v_n from private.web_chat_requests
      where session_id = v_s.id and kind = 'message' and created_at > now() - interval '10 minutes';
    if p_kind = 'message' and v_n >= 20 then return jsonb_build_object('status','rate_limited'); end if;
    select count(*) into v_n from private.web_chat_requests
      where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if v_n >= 60 then return jsonb_build_object('status','rate_limited'); end if;
    if p_kind = 'message' then
      insert into private.web_chat_messages (session_id, request_id, role, content)
        values (v_s.id, p_request, 'user', v_text) returning id into v_msg;
    end if;
    insert into private.web_chat_requests (session_id, request_id, kind, status, ip_hash, user_message_id)
      values (v_s.id, p_request, p_kind, 'pending', p_ip_hash, v_msg);
  else
    if v_r.attempts >= 3 then return jsonb_build_object('status','failed'); end if;
    update private.web_chat_requests set status = 'pending', attempts = attempts + 1, updated_at = now()
      where session_id = v_s.id and request_id = p_request;
  end if;

  update private.web_chat_sessions set lease_request = p_request,
    lease_until = now() + interval '120 seconds', last_seen_at = now() where id = v_s.id;

  return jsonb_build_object('status','proceed', 'request_id', p_request,
    'model', v_cfg.model, 'temperature', v_cfg.temperature, 'prompt_ids', to_jsonb(v_cfg.prompt_ids),
    'assistant_name', v_cfg.assistant_name, 'contact', v_s.contact,
    'history', private.web_chat_history(v_s.id, 40));
end $$;

-- Conclui a geração. Só o detentor do lease grava; resposta grava uma vez.
create function private.web_chat_finish(p_empresa bigint, p_token_hash text, p_request uuid,
  p_reply text, p_contact jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s private.web_chat_sessions; v_r private.web_chat_requests; v_id bigint;
  v_reply text := btrim(coalesce(p_reply,''));
begin
  select * into v_s from private.web_chat_sessions
    where token_hash = p_token_hash and empresa_id = p_empresa for update;
  if not found then return jsonb_build_object('status','no_session'); end if;
  select * into v_r from private.web_chat_requests where session_id = v_s.id and request_id = p_request;
  if not found then return jsonb_build_object('status','invalid'); end if;
  if v_r.status = 'done' then return jsonb_build_object('status','done'); end if;
  if v_s.lease_request is distinct from p_request then return jsonb_build_object('status','lease_lost'); end if;

  if length(v_reply) = 0 then
    update private.web_chat_requests set status = 'failed', updated_at = now()
      where session_id = v_s.id and request_id = p_request;
  else
    insert into private.web_chat_messages (session_id, request_id, role, content)
      values (v_s.id, p_request, 'assistant', left(v_reply, 8000)) returning id into v_id;
    update private.web_chat_requests set status = 'done', reply_message_id = v_id, updated_at = now()
      where session_id = v_s.id and request_id = p_request;
    if v_r.kind = 'greeting' then
      update private.web_chat_sessions set greeted_at = coalesce(greeted_at, now()) where id = v_s.id;
    end if;
  end if;
  update private.web_chat_sessions set lease_request = null, lease_until = null,
    contact = case when jsonb_typeof(p_contact) = 'object' then contact || p_contact else contact end
    where id = v_s.id;
  if v_id is null then return jsonb_build_object('status','failed'); end if;
  return jsonb_build_object('status','done','reply',
    (select jsonb_build_object('id', id, 'role', role, 'content', content, 'created_at', created_at)
       from private.web_chat_messages where id = v_id));
end $$;

revoke all on function private.web_chat_history(uuid,int), private.web_chat_open(bigint,text,text),
  private.web_chat_begin(bigint,text,text,uuid,text,text), private.web_chat_finish(bigint,text,uuid,text,jsonb)
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.web_chat_open(bigint,text,text),
  private.web_chat_begin(bigint,text,text,uuid,text,text),
  private.web_chat_finish(bigint,text,uuid,text,jsonb) to service_role;

create function public.web_chat_open(p_empresa bigint, p_token_hash text, p_ip_hash text)
returns jsonb language sql security invoker set search_path = '' as
$$ select private.web_chat_open(p_empresa, p_token_hash, p_ip_hash) $$;
create function public.web_chat_begin(p_empresa bigint, p_token_hash text, p_ip_hash text,
  p_request uuid, p_kind text, p_text text)
returns jsonb language sql security invoker set search_path = '' as
$$ select private.web_chat_begin(p_empresa, p_token_hash, p_ip_hash, p_request, p_kind, p_text) $$;
create function public.web_chat_finish(p_empresa bigint, p_token_hash text, p_request uuid,
  p_reply text, p_contact jsonb)
returns jsonb language sql security invoker set search_path = '' as
$$ select private.web_chat_finish(p_empresa, p_token_hash, p_request, p_reply, p_contact) $$;
revoke all on function public.web_chat_open(bigint,text,text),
  public.web_chat_begin(bigint,text,text,uuid,text,text),
  public.web_chat_finish(bigint,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.web_chat_open(bigint,text,text),
  public.web_chat_begin(bigint,text,text,uuid,text,text),
  public.web_chat_finish(bigint,text,uuid,text,jsonb) to service_role;
-- === pglite-core-end ===

-- Configuração inicial (desativada; ligar após revisão e teste):
insert into private.web_chat_config (empresa_id) values (38) on conflict do nothing;
-- update private.web_chat_config set enabled = true where empresa_id = 38;
-- Foto: update private.web_chat_config set avatar_url = 'https://...' where empresa_id = 38;

-- Rollback (remove somente objetos deste arquivo):
-- drop function if exists public.web_chat_open(bigint,text,text), public.web_chat_begin(bigint,text,text,uuid,text,text), public.web_chat_finish(bigint,text,uuid,text,jsonb);
-- drop function if exists private.web_chat_open(bigint,text,text), private.web_chat_begin(bigint,text,text,uuid,text,text), private.web_chat_finish(bigint,text,uuid,text,jsonb), private.web_chat_history(uuid,int);
-- drop table if exists private.web_chat_messages, private.web_chat_requests, private.web_chat_sessions, private.web_chat_config;
