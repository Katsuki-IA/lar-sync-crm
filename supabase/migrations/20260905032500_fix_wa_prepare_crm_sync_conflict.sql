-- Evita ambiguidade entre as colunas de retorno PL/pgSQL e as colunas usadas
-- como chave do UPSERT.

create or replace function public.wa_prepare_crm_sync(
  p_id_empresa bigint,
  p_lead_id bigint,
  p_provider text,
  p_action text default 'create_lead',
  p_payload jsonb default '{}'::jsonb
)
returns table (
  queue_id uuid,
  decision text,
  provider text,
  action text,
  lead_id bigint,
  wa_identity_id uuid,
  telefone text,
  external_id text,
  blocked_reason text
)
language plpgsql
set search_path = ''
as $$
declare
  v_lead public.lead%rowtype;
  v_provider text := lower(nullif(pg_catalog.btrim(p_provider), ''));
  v_action text := lower(coalesce(nullif(pg_catalog.btrim(p_action), ''), 'create_lead'));
  v_phone text;
  v_status text;
  v_reason text;
  v_queue public.wa_crm_sync_queue%rowtype;
begin
  if p_id_empresa is null or p_lead_id is null or v_provider is null then
    raise exception using
      errcode = '22023',
      message = 'empresa, lead e provider sao obrigatorios para preparar sincronizacao CRM';
  end if;

  select l.* into v_lead
  from public.lead l
  where l.id = p_lead_id
    and l.id_empresa = p_id_empresa;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'lead nao encontrado para preparar sincronizacao CRM';
  end if;

  v_phone := nullif(
    pg_catalog.regexp_replace(coalesce(v_lead.numero::text, ''), '[^0-9]', '', 'g'),
    ''
  );

  if nullif(pg_catalog.btrim(v_lead.id_crm::text), '') is not null then
    v_status := 'already_linked';
    v_reason := null;
  elsif v_phone is null then
    v_status := 'waiting_phone';
    v_reason := 'missing_phone';
  else
    v_status := 'ready';
    v_reason := null;
  end if;

  insert into public.wa_crm_sync_queue as q (
    id_empresa, lead_id, wa_identity_id, provider, action, status,
    blocked_reason, external_id, payload, available_at, processed_at,
    last_error, updated_at
  ) values (
    p_id_empresa, p_lead_id, v_lead.wa_identity_id, v_provider, v_action,
    v_status, v_reason, nullif(pg_catalog.btrim(v_lead.id_crm::text), ''),
    coalesce(p_payload, '{}'::jsonb),
    case when v_status = 'ready' then pg_catalog.now() else null end,
    case when v_status = 'already_linked' then pg_catalog.now() else null end,
    null, pg_catalog.now()
  )
  on conflict on constraint wa_crm_sync_queue_lead_provider_action_key
  do update set
    wa_identity_id = coalesce(excluded.wa_identity_id, q.wa_identity_id),
    status = excluded.status,
    blocked_reason = excluded.blocked_reason,
    external_id = coalesce(excluded.external_id, q.external_id),
    payload = case when excluded.payload = '{}'::jsonb then q.payload else excluded.payload end,
    available_at = excluded.available_at,
    processed_at = excluded.processed_at,
    locked_at = null,
    last_error = null,
    updated_at = pg_catalog.now()
  returning q.* into v_queue;

  return query select
    v_queue.id, v_queue.status, v_queue.provider, v_queue.action,
    v_queue.lead_id, v_queue.wa_identity_id, v_phone,
    v_queue.external_id, v_queue.blocked_reason;
end;
$$;

revoke all on function public.wa_prepare_crm_sync(bigint, bigint, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.wa_prepare_crm_sync(bigint, bigint, text, text, jsonb)
  to service_role;
