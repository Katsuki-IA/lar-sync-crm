-- ============================================================================
-- SQL CANDIDATO — Secretária, fase 1 (interpretação de texto)
-- NÃO APLICADO. Revisar e aplicar manualmente quando autorizado.
-- Objetos novos: tabela de configuração + RPCs usados pelo app
-- (src/lib/secretary-adapter.server.ts) e o desvio de mensagens livres no
-- webhook existente. Nada aqui altera o comando legado ACEITAR/RECUSAR.
-- ============================================================================

-- Configuração por empresa: tom, regras (prompt base) e ativação.
create table if not exists public.hub_secretary_ai_settings (
  id_empresa bigint primary key references public.empresa_dados(id),
  enabled boolean not null default false,
  tone text not null default 'cordial' check (tone in ('cordial','objetivo','formal')),
  base_prompt text check (base_prompt is null or length(base_prompt) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Sem acesso direto de authenticated/anon: somente via RPCs abaixo.
revoke all on public.hub_secretary_ai_settings from authenticated, anon;

-- Leitura da configuração (gestor da empresa ou super_admin).
create or replace function public.hub_secretary_ai_get(p_company_id bigint)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare actor public.crm_users;
begin
  select * into actor from public.crm_users where auth_user_id = auth.uid() and active;
  if actor.id is null or actor.role not in ('manager','gestor','super_admin')
     or not private.crm_can_access_empresa(p_company_id) then
    raise exception 'Configuração restrita ao gestor da empresa' using errcode = '42501';
  end if;
  return (select jsonb_build_object('enabled', s.enabled, 'tone', s.tone, 'base_prompt', s.base_prompt)
          from public.hub_secretary_ai_settings s where s.id_empresa = p_company_id);
end $$;

-- Escrita da configuração: somente super_admin.
create or replace function public.hub_secretary_ai_save(
  p_company_id bigint, p_enabled boolean, p_tone text, p_base_prompt text
) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare actor public.crm_users;
begin
  select * into actor from public.crm_users where auth_user_id = auth.uid() and active;
  if actor.id is null or actor.role is distinct from 'super_admin' then
    raise exception 'Somente super_admin pode configurar a interpretação de texto' using errcode = '42501';
  end if;
  if p_tone not in ('cordial','objetivo','formal') then
    raise exception 'Tom inválido' using errcode = '22023';
  end if;
  insert into public.hub_secretary_ai_settings (id_empresa, enabled, tone, base_prompt)
  values (p_company_id, p_enabled, p_tone, nullif(btrim(p_base_prompt), ''))
  on conflict (id_empresa) do update
    set enabled = excluded.enabled, tone = excluded.tone,
        base_prompt = excluded.base_prompt, updated_at = now();
  return '{}'::jsonb;
end $$;

-- Resolve empresa + membro pelo canal (instância) e telefone do remetente.
-- Mesma regra do webhook atual: destinatário habilitado, membro ativo,
-- papel de corretor e CRM habilitado. Chamada somente com service role.
create or replace function public.hub_secretary_resolve_sender(p_instance text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare row record;
begin
  select c.id_empresa as company_id, r.member_id, u.active as member_active, m.crm as crm_enabled
    into row
    from public.hub_whatsapp_channels c
    join private.hub_whatsapp_recipients r on r.id_empresa = c.id_empresa and r.enabled
    join public.crm_users u on u.id = r.member_id and u.id_empresa = r.id_empresa
       and u.role in ('agent','corretor')
    join public.hub_company_modules m on m.id_empresa = c.id_empresa
   where c.instance = p_instance and c.enabled and r.phone = p_phone;
  if row is null then return null; end if;
  return jsonb_build_object('company_id', row.company_id, 'member_id', row.member_id,
                            'member_active', row.member_active, 'crm_enabled', row.crm_enabled);
end $$;

-- Idempotência: consulta e registro do evento processado (mesma tabela do
-- fluxo legado, private.hub_whatsapp_incoming).
create or replace function public.hub_secretary_find_incoming(p_company_id bigint, p_event_id text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare row record;
begin
  select i.member_id, i.body, i.result into row
    from private.hub_whatsapp_incoming i
   where i.id_empresa = p_company_id and i.event_id = p_event_id;
  if row is null then return null; end if;
  return jsonb_build_object('member_id', row.member_id, 'body', row.body, 'result', row.result);
end $$;

create or replace function public.hub_secretary_record_incoming(
  p_company_id bigint, p_event_id text, p_member_id uuid, p_body text, p_result jsonb
) returns jsonb language plpgsql security definer set search_path = public, private as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || p_event_id, 44));
  insert into private.hub_whatsapp_incoming (id_empresa, event_id, member_id, body, result)
  values (p_company_id, p_event_id, p_member_id, p_body, p_result);
  insert into public.hub_secretary_responses (id_empresa, member_id, request_id, body, notice_id, result, channel)
  values (p_company_id, p_member_id, gen_random_uuid(), p_body, null, p_result,
          (select provider from public.hub_whatsapp_channels where id_empresa = p_company_id));
  return '{}'::jsonb;
end $$;

-- Ofertas pendentes e não expiradas do próprio membro (com código do aviso).
create or replace function public.hub_secretary_list_pending_offers(p_company_id bigint, p_member_id uuid)
returns jsonb language sql security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'code', n.code, 'title', o.opportunity_title, 'expires_at', o.expires_at)
           order by o.created_at), '[]'::jsonb)
    from public.hub_sales_offers o
    join public.hub_secretary_notices n on n.offer_id = o.id
   where o.id_empresa = p_company_id and o.member_id = p_member_id
     and o.status = 'pending' and o.expires_at > clock_timestamp();
$$;

-- Leads atribuídos ao membro, com limite (paginação simples por quantidade).
create or replace function public.hub_secretary_list_member_leads(
  p_company_id bigint, p_member_id uuid, p_limit integer
) returns jsonb language sql security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'stage', t.stage)
           order by t.created_at desc), '[]'::jsonb)
    from (select op.id, op.title, s.nome as stage, op.created_at
            from public.crm_opportunities op
            left join public.crm_stages s on s.id = op.crm_stage_id
           where op.id_empresa = p_company_id and op.assigned_to = p_member_id
           order by op.created_at desc
           limit least(greatest(p_limit, 1), 50)) t;
$$;

-- Aceite/recusa reutilizando a operação atômica existente, que revalida
-- propriedade, expiração, fila e módulo no momento da execução.
create or replace function public.hub_secretary_respond_offer(
  p_offer uuid, p_action text, p_member uuid
) returns jsonb language plpgsql security definer set search_path = public, private as $$
begin
  return private.hub_respond_sales_offer_as(p_offer, p_action, p_member);
end $$;

-- Resposta ao corretor enfileirada no outbox existente (envio continua a
-- cargo do worker já configurado; nada aqui envia WhatsApp diretamente).
create or replace function public.hub_secretary_enqueue_reply(
  p_company_id bigint, p_member_id uuid, p_body text
) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare notice uuid;
begin
  -- Mensagens livres não têm aviso de origem: registra um aviso sintético
  -- para reutilizar o outbox sem alterar seu esquema.
  insert into public.hub_secretary_notices (offer_id, id_empresa, member_id, code, body, channel)
  select o.id, p_company_id, p_member_id, 'REPLY', p_body, c.provider
    from public.hub_sales_offers o
    join public.hub_whatsapp_channels c on c.id_empresa = p_company_id
   where o.id_empresa = p_company_id and o.member_id = p_member_id
   order by o.created_at desc limit 1
  returning id into notice;
  if notice is null then
    raise exception 'Sem aviso de referência para enfileirar resposta' using errcode = '22023';
  end if;
  insert into public.hub_whatsapp_outbox (notice_id, id_empresa, member_id, status, attempts, available_at)
  values (notice, p_company_id, p_member_id, 'pending', 0, now());
  return '{}'::jsonb;
end $$;

-- Desvio no webhook existente: mensagens que NÃO são o comando legado são
-- encaminhadas ao endpoint do app (/api/public/secretary/interpret) via
-- pg_net, mantendo o segredo de webhook. Trecho ilustrativo a incorporar em
-- private.hub_receive_whatsapp após a checagem de parts:
--
--   if parts is null then
--     perform net.http_post(
--       url := 'https://hub.katsuki.com.br/api/public/secretary/interpret',
--       headers := jsonb_build_object('content-type','application/json',
--                                     'x-hub-webhook-secret', <segredo de webhook>),
--       body := jsonb_build_object('phone', p_phone, 'event_id', p_event_id, 'body', p_body));
--     return jsonb_build_object('status','forwarded');
--   end if;
