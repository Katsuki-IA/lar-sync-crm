-- Chat web público da Clara (/chat) — SQL CANDIDATO, NÃO APLICADO.
-- Aplicação manual pela responsável após aprovação específica. Rollback no fim.
--
-- Fatos lidos do banco (2026-11-19, somente leitura):
-- * crm_leads.telefone NOT NULL; public.lead exige numero OU wa_identity_id.
-- * Gatilhos de INSERT em crm_leads: crm_enqueue_new_lead_if_enabled (sai sem
--   empreendimento), hub_capture_queue_intake (insere em private.hub_queue_intake
--   quando a empresa tem CRM — empresa 38 tem), crm_dispatch_on_qualified (só
--   qualificado=1), blocked_send_alert_hub (só empresa 33), wa_ctwa_attach_after_lead
--   (atribuição CTWA por telefone). Em public.lead: enqueue_external_qualification
--   sai cedo quando default_crm='hub' (empresa 38); wa_* são no-op sem wa_identity_id.
-- * commercial_schedule_manage exige lead.id_crm do CRM da mesma empresa, cria
--   task (reminder_minutes nulo => sem lembrete) e activity; não envia WhatsApp.
--   O retorno 'notify' é ignorado pelo chat web.
--
-- Revisão de seletores (2026-11-19): followups v2 e crm_preserve_qualified_attendance filtram
--   status ativo/agendando => 'web_chat' fica fora. wa_get_or_create_lead e
--   wa_resolve_conversation_identity casam por telefone SEM filtro de status: uma
--   mensagem futura de WhatsApp desse número reutilizará este lead (ver limitações).
-- Decisões:
-- * Promoção ao CRM só com nome + telefone presentes nas mensagens do visitante;
--   sem empreendimento, qualificado=0, origem 'SI' (site), marcada "Chat web".
--   A entrada em hub_queue_intake criada pelo gatilho é removida na MESMA
--   transação (nenhum worker a vê). Se já existir lead/CRM com o mesmo telefone
--   na empresa, NÃO promove nem mescla: sessão fica 'phone_conflict' no Hub.
-- * Só e-mail: fica na sessão, visível no Hub > Chat web (super_admin/gestor da 38).
-- * Lease com token único por tentativa (120s); finish/ferramentas validam
--   token + request + validade. Inferência total limitada a 95s no servidor.
-- * Limites com advisory lock por IP; tentativas (attempts) contam no limite.

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
  lease_token uuid,
  lease_until timestamptz,
  contact jsonb not null default '{}'::jsonb,
  crm_status text not null default 'none' check (crm_status in ('none','promoted','phone_conflict')),
  crm_lead_id bigint,
  lead_id bigint,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index on private.web_chat_sessions (ip_hash, created_at);
create index on private.web_chat_sessions (empresa_id, last_seen_at desc);

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

create function private.web_chat_history(p_session uuid, p_limit int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role,
    'content', m.content, 'created_at', m.created_at) order by m.id), '[]'::jsonb)
  from (select * from private.web_chat_messages
        where session_id = p_session order by id desc limit greatest(1, least(p_limit, 200))) m
$$;

create function private.web_chat_ip_lock(p_ip_hash text)
returns void language sql security definer set search_path = '' as
$$ select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('clara-ip:' || p_ip_hash, 0)) $$;

create function private.web_chat_open(p_empresa bigint, p_token_hash text, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cfg private.web_chat_config; v_s private.web_chat_sessions; v_recent int;
begin
  select * into v_cfg from private.web_chat_config where empresa_id = p_empresa;
  if not found or not v_cfg.enabled then return jsonb_build_object('status','disabled'); end if;
  select * into v_s from private.web_chat_sessions where token_hash = p_token_hash and empresa_id = p_empresa;
  if not found then
    perform private.web_chat_ip_lock(p_ip_hash);
    select count(*) into v_recent from private.web_chat_sessions
      where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if v_recent >= 10 then return jsonb_build_object('status','rate_limited'); end if;
    insert into private.web_chat_sessions (empresa_id, token_hash, ip_hash)
      values (p_empresa, p_token_hash, p_ip_hash)
      on conflict (token_hash) do nothing returning * into v_s;
    if v_s.id is null then return jsonb_build_object('status','invalid'); end if;
  else
    update private.web_chat_sessions set last_seen_at = now() where id = v_s.id;
  end if;
  return jsonb_build_object('status','ok',
    'config', jsonb_build_object('assistant_name', v_cfg.assistant_name,
      'avatar_url', v_cfg.avatar_url, 'avatar_fallback', v_cfg.avatar_fallback),
    'greeted', v_s.greeted_at is not null,
    'messages', private.web_chat_history(v_s.id, 100));
end $$;

-- proceed (com lease_token) | done | busy | rate_limited | disabled | no_session | invalid | failed
create function private.web_chat_begin(p_empresa bigint, p_token_hash text, p_ip_hash text,
  p_request uuid, p_kind text, p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cfg private.web_chat_config; v_s private.web_chat_sessions;
  v_r private.web_chat_requests; v_msg bigint; v_n int; v_lease uuid;
  v_text text := btrim(coalesce(p_text,''));
begin
  if p_request is null or p_kind not in ('greeting','message') then
    return jsonb_build_object('status','invalid'); end if;
  if p_kind = 'message' and (length(v_text) < 1 or length(v_text) > 2000) then
    return jsonb_build_object('status','invalid'); end if;
  if p_kind = 'greeting' and v_text <> '' then return jsonb_build_object('status','invalid'); end if;
  select * into v_cfg from private.web_chat_config where empresa_id = p_empresa;
  if not found or not v_cfg.enabled then return jsonb_build_object('status','disabled'); end if;
  perform private.web_chat_ip_lock(p_ip_hash);
  select * into v_s from private.web_chat_sessions
    where token_hash = p_token_hash and empresa_id = p_empresa for update;
  if not found then return jsonb_build_object('status','no_session'); end if;

  select * into v_r from private.web_chat_requests where session_id = v_s.id and request_id = p_request;
  if found then
    if v_r.kind <> p_kind then return jsonb_build_object('status','invalid'); end if;
    -- Reuso do requestId com texto diferente é inválido.
    if p_kind = 'message' and (select content from private.web_chat_messages
         where id = v_r.user_message_id) is distinct from v_text then
      return jsonb_build_object('status','invalid'); end if;
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
    if v_r.request_id is null then
      select * into v_r from private.web_chat_requests where session_id = v_s.id and kind = 'greeting';
      if found then p_request := v_r.request_id; end if;
    end if;
  end if;

  -- Limites contam tentativas (attempts), inclusive falhas e retries.
  select coalesce(sum(attempts),0) into v_n from private.web_chat_requests
    where session_id = v_s.id and kind = 'message' and created_at > now() - interval '10 minutes';
  if p_kind = 'message' and v_n >= 20 then return jsonb_build_object('status','rate_limited'); end if;
  select coalesce(sum(attempts),0) into v_n from private.web_chat_requests
    where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
  if v_n >= 60 then return jsonb_build_object('status','rate_limited'); end if;

  if v_r.request_id is null then
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

  v_lease := gen_random_uuid();
  update private.web_chat_sessions set lease_request = p_request, lease_token = v_lease,
    lease_until = now() + interval '120 seconds', last_seen_at = now() where id = v_s.id;

  return jsonb_build_object('status','proceed', 'request_id', p_request, 'lease_token', v_lease,
    'model', v_cfg.model, 'temperature', v_cfg.temperature, 'prompt_ids', to_jsonb(v_cfg.prompt_ids),
    'assistant_name', v_cfg.assistant_name, 'contact', v_s.contact,
    'crm_status', v_s.crm_status, 'history', private.web_chat_history(v_s.id, 40));
end $$;

-- Valida e trava a sessão do detentor do lease vigente.
create function private.web_chat_lease_session(p_empresa bigint, p_token_hash text, p_request uuid, p_lease uuid)
returns private.web_chat_sessions language plpgsql security definer set search_path = '' as $$
declare v_s private.web_chat_sessions;
begin
  select * into v_s from private.web_chat_sessions
    where token_hash = p_token_hash and empresa_id = p_empresa for update;
  if not found or p_lease is null or v_s.lease_token is distinct from p_lease
     or v_s.lease_request is distinct from p_request or v_s.lease_until is null or v_s.lease_until <= now() then
    return null;
  end if;
  return v_s;
end $$;

create function private.web_chat_finish(p_empresa bigint, p_token_hash text, p_request uuid,
  p_lease uuid, p_reply text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s private.web_chat_sessions; v_r private.web_chat_requests; v_id bigint;
  v_reply text := btrim(coalesce(p_reply,''));
begin
  v_s := private.web_chat_lease_session(p_empresa, p_token_hash, p_request, p_lease);
  if v_s.id is null then return jsonb_build_object('status','lease_lost'); end if;
  select * into v_r from private.web_chat_requests where session_id = v_s.id and request_id = p_request for update;
  if not found or v_r.status <> 'pending' then return jsonb_build_object('status','lease_lost'); end if;

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
  update private.web_chat_sessions set lease_request = null, lease_token = null, lease_until = null where id = v_s.id;
  if v_id is null then return jsonb_build_object('status','failed'); end if;
  return jsonb_build_object('status','done','reply',
    (select jsonb_build_object('id', id, 'role', role, 'content', content, 'created_at', created_at)
       from private.web_chat_messages where id = v_id));
end $$;

-- Ferramenta registrar_contato. O servidor já confirmou que os valores aparecem
-- nas mensagens do visitante; aqui revalida lease e formato e promove ao CRM
-- somente com telefone real e sem lead existente com o mesmo telefone.
create function private.web_chat_save_contact(p_empresa bigint, p_token_hash text, p_request uuid,
  p_lease uuid, p_nome text, p_email text, p_telefone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s private.web_chat_sessions; v_nome text := btrim(coalesce(p_nome,''));
  v_email text := nullif(lower(btrim(coalesce(p_email,''))),'');
  v_tel text := nullif(regexp_replace(coalesce(p_telefone,''),'[^0-9]','','g'),'');
  v_key text; v_crm bigint; v_lead bigint; v_actor uuid;
begin
  v_s := private.web_chat_lease_session(p_empresa, p_token_hash, p_request, p_lease);
  if v_s.id is null then return jsonb_build_object('outcome','lease_lost'); end if;
  if length(v_nome) not between 2 and 120
     or (v_email is not null and v_email !~ '^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$')
     or (v_tel is not null and length(v_tel) not between 10 and 13)
     or (v_email is null and v_tel is null) then
    return jsonb_build_object('outcome','invalid');
  end if;
  update private.web_chat_sessions set contact = contact || jsonb_strip_nulls(jsonb_build_object(
      'nome', v_nome, 'email', v_email, 'telefone', v_tel, 'informado_em', now()))
    where id = v_s.id;
  if v_s.crm_status = 'promoted' then return jsonb_build_object('outcome','saved','crm','promoted'); end if;
  if v_tel is null then return jsonb_build_object('outcome','saved','crm','none'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('clara-phone:' || p_empresa || ':' || v_tel, 0));
  v_key := public.crm_phone_match_key(v_tel);
  if exists (select 1 from public.crm_leads c where c.id_empresa = p_empresa and public.crm_phone_match_key(c.telefone) = v_key)
     or exists (select 1 from public.lead l where l.id_empresa = p_empresa and public.crm_phone_match_key(l.numero) = v_key) then
    update private.web_chat_sessions set crm_status = 'phone_conflict' where id = v_s.id;
    return jsonb_build_object('outcome','saved','crm','phone_conflict');
  end if;

  insert into public.crm_leads (id_empresa, nome, telefone, email, origem, qualificado, observacoes)
    values (p_empresa, v_nome, v_tel, v_email, 'SI', 0, 'Chat web (Clara) — sessão ' || v_s.id::text)
    returning id into v_crm;
  -- Gatilho hub_capture_queue_intake criou entrada de fila: remover na mesma transação.
  delete from private.hub_queue_intake where lead_id = v_crm;
  -- status 'web_chat': fora de followup_dispatch_validation_v2, live/preview_followup_candidates_v2
  -- e crm_preserve_qualified_attendance (todos exigem ativo/agendando); agenda segue permitida.
  insert into public.lead (id_empresa, nome, numero, email, id_crm, atendimento_humano, status)
    values (p_empresa, v_nome, v_tel, v_email, v_crm::text, false, 'web_chat')
    returning id into v_lead;
  v_actor := public.crm_get_or_create_ai_user(p_empresa);
  insert into public.crm_lead_activities (lead_id, crm_user_id, tipo, descricao, metadata)
    values (v_crm, v_actor, 'web_chat', 'Lead criado pelo chat web da Clara',
      jsonb_build_object('source','web_chat','session_id', v_s.id, 'lead_id', v_lead));
  update private.web_chat_sessions set crm_status = 'promoted', crm_lead_id = v_crm,
    lead_id = v_lead, promoted_at = now() where id = v_s.id;
  return jsonb_build_object('outcome','saved','crm','promoted');
end $$;

-- Agenda: só para a sessão promovida, usando o lead NOVO vinculado a ela.
create function private.web_chat_schedule(p_empresa bigint, p_token_hash text, p_request uuid,
  p_lease uuid, p_op text, p_day date, p_time time, p_period text, p_booking bigint, p_revision int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s private.web_chat_sessions; v_key text;
begin
  v_s := private.web_chat_lease_session(p_empresa, p_token_hash, p_request, p_lease);
  if v_s.id is null then return jsonb_build_object('outcome','lease_lost'); end if;
  if v_s.crm_status <> 'promoted' or v_s.lead_id is null then
    return jsonb_build_object('outcome','contact_required'); end if;
  begin
    if p_op = 'opcoes' then
      return public.commercial_schedule_options(p_empresa, v_s.lead_id, p_day, p_period);
    elsif p_op in ('agendar','reagendar','cancelar') then
      -- Chave estável por pedido do visitante: retries repetem o mesmo resultado.
      v_key := 'webchat:' || v_s.id::text || ':' || p_request::text || ':' || p_op || ':'
        || coalesce(p_day::text,'') || ':' || coalesce(p_time::text,'') || ':' || coalesce(p_booking::text,'');
      return public.commercial_schedule_manage(p_empresa, v_s.lead_id, p_op, p_day, p_time, p_booking, p_revision, left(v_key, 500));
    end if;
    return jsonb_build_object('outcome','invalid');
  exception when others then
    return jsonb_build_object('outcome','error', 'code', left(sqlerrm, 60));
  end;
end $$;

-- Hub > Chat web: super_admin ou gestor da própria empresa.
create function private.web_chat_hub_sessions(p_empresa bigint, p_limit int, p_offset int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.crm_can_manage_empresa(p_empresa), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(row_to_json(x) order by x.last_seen_at desc), '[]'::jsonb) from (
    select s.id, s.contact, s.crm_status, s.crm_lead_id, s.created_at, s.last_seen_at,
      (select count(*) from private.web_chat_messages m where m.session_id = s.id) as total_mensagens,
      (select left(m.content, 160) from private.web_chat_messages m where m.session_id = s.id order by m.id desc limit 1) as ultima_mensagem
    from private.web_chat_sessions s
    where s.empresa_id = p_empresa and exists (select 1 from private.web_chat_messages m where m.session_id = s.id and m.role = 'user')
    order by s.last_seen_at desc limit greatest(1, least(p_limit, 100)) offset greatest(p_offset, 0)) x);
end $$;

create function private.web_chat_hub_messages(p_empresa bigint, p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.crm_can_manage_empresa(p_empresa), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from private.web_chat_sessions where id = p_session and empresa_id = p_empresa) then
    return '[]'::jsonb; end if;
  return private.web_chat_history(p_session, 200);
end $$;

revoke all on function private.web_chat_history(uuid,int), private.web_chat_ip_lock(text),
  private.web_chat_open(bigint,text,text), private.web_chat_begin(bigint,text,text,uuid,text,text),
  private.web_chat_lease_session(bigint,text,uuid,uuid), private.web_chat_finish(bigint,text,uuid,uuid,text),
  private.web_chat_save_contact(bigint,text,uuid,uuid,text,text,text),
  private.web_chat_schedule(bigint,text,uuid,uuid,text,date,time,text,bigint,int),
  private.web_chat_hub_sessions(bigint,int,int), private.web_chat_hub_messages(bigint,uuid)
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role, authenticated;
grant execute on function private.web_chat_open(bigint,text,text),
  private.web_chat_begin(bigint,text,text,uuid,text,text),
  private.web_chat_finish(bigint,text,uuid,uuid,text),
  private.web_chat_save_contact(bigint,text,uuid,uuid,text,text,text),
  private.web_chat_schedule(bigint,text,uuid,uuid,text,date,time,text,bigint,int) to service_role;
grant execute on function private.web_chat_hub_sessions(bigint,int,int),
  private.web_chat_hub_messages(bigint,uuid) to authenticated;

create function public.web_chat_open(p_empresa bigint, p_token_hash text, p_ip_hash text)
returns jsonb language sql security invoker set search_path = '' as
$$ select private.web_chat_open(p_empresa, p_token_hash, p_ip_hash) $$;
create function public.web_chat_begin(p_empresa bigint, p_token_hash text, p_ip_hash text,
  p_request uuid, p_kind text, p_text text)
returns jsonb language sql security invoker set search_path = '' as
$$ select private.web_chat_begin(p_empresa, p_token_hash, p_ip_hash, p_request, p_kind, p_text) $$;
create function public.web_chat_finish(p_empresa bigint, p_token_hash text, p_request uuid, p_lease uuid, p_reply text)
returns jsonb language sql security invoker set search_path = '' as
$$ select private.web_chat_finish(p_empresa, p_token_hash, p_request, p_lease, p_reply) $$;
create function public.web_chat_save_contact(p_empresa bigint, p_token_hash text, p_request uuid, p_lease uuid,
  p_nome text, p_email text, p_telefone text)
returns jsonb language sql security invoker set search_path = '' as
$$ select private.web_chat_save_contact(p_empresa, p_token_hash, p_request, p_lease, p_nome, p_email, p_telefone) $$;
create function public.web_chat_schedule(p_empresa bigint, p_token_hash text, p_request uuid, p_lease uuid,
  p_op text, p_day date, p_time time, p_period text, p_booking bigint, p_revision int)
returns jsonb language sql security invoker set search_path = '' as
$$ select private.web_chat_schedule(p_empresa, p_token_hash, p_request, p_lease, p_op, p_day, p_time, p_period, p_booking, p_revision) $$;
create function public.web_chat_hub_sessions(p_empresa bigint, p_limit int, p_offset int)
returns jsonb language sql security invoker set search_path = '' as
$$ select private.web_chat_hub_sessions(p_empresa, p_limit, p_offset) $$;
create function public.web_chat_hub_messages(p_empresa bigint, p_session uuid)
returns jsonb language sql security invoker set search_path = '' as
$$ select private.web_chat_hub_messages(p_empresa, p_session) $$;

revoke all on function public.web_chat_open(bigint,text,text),
  public.web_chat_begin(bigint,text,text,uuid,text,text),
  public.web_chat_finish(bigint,text,uuid,uuid,text),
  public.web_chat_save_contact(bigint,text,uuid,uuid,text,text,text),
  public.web_chat_schedule(bigint,text,uuid,uuid,text,date,time,text,bigint,int),
  public.web_chat_hub_sessions(bigint,int,int), public.web_chat_hub_messages(bigint,uuid)
  from public, anon, authenticated;
grant execute on function public.web_chat_open(bigint,text,text),
  public.web_chat_begin(bigint,text,text,uuid,text,text),
  public.web_chat_finish(bigint,text,uuid,uuid,text),
  public.web_chat_save_contact(bigint,text,uuid,uuid,text,text,text),
  public.web_chat_schedule(bigint,text,uuid,uuid,text,date,time,text,bigint,int) to service_role;
grant execute on function public.web_chat_hub_sessions(bigint,int,int),
  public.web_chat_hub_messages(bigint,uuid) to authenticated;
-- === pglite-core-end ===

insert into private.web_chat_config (empresa_id) values (38) on conflict do nothing;
-- Ligar após revisão: update private.web_chat_config set enabled = true where empresa_id = 38;
-- Foto: update private.web_chat_config set avatar_url = 'https://...' where empresa_id = 38;

-- Rollback (somente objetos deste arquivo; leads já promovidos permanecem no CRM):
-- drop function if exists public.web_chat_open(bigint,text,text), public.web_chat_begin(bigint,text,text,uuid,text,text),
--   public.web_chat_finish(bigint,text,uuid,uuid,text), public.web_chat_save_contact(bigint,text,uuid,uuid,text,text,text),
--   public.web_chat_schedule(bigint,text,uuid,uuid,text,date,time,text,bigint,int),
--   public.web_chat_hub_sessions(bigint,int,int), public.web_chat_hub_messages(bigint,uuid);
-- drop function if exists private.web_chat_open(bigint,text,text), private.web_chat_begin(bigint,text,text,uuid,text,text),
--   private.web_chat_finish(bigint,text,uuid,uuid,text), private.web_chat_save_contact(bigint,text,uuid,uuid,text,text,text),
--   private.web_chat_schedule(bigint,text,uuid,uuid,text,date,time,text,bigint,int),
--   private.web_chat_hub_sessions(bigint,int,int), private.web_chat_hub_messages(bigint,uuid),
--   private.web_chat_lease_session(bigint,text,uuid,uuid), private.web_chat_ip_lock(text), private.web_chat_history(uuid,int);
-- drop table if exists private.web_chat_messages, private.web_chat_requests, private.web_chat_sessions, private.web_chat_config;
