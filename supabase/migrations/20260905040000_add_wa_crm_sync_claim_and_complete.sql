-- Ciclo idempotente da fila de sincronização dos leads WhatsApp.

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
    status = case
      when excluded.status = 'already_linked' then 'already_linked'
      when q.status in ('processing', 'sent') then q.status
      else excluded.status
    end,
    blocked_reason = case
      when excluded.status = 'already_linked' then null
      when q.status in ('processing', 'sent') then q.blocked_reason
      else excluded.blocked_reason
    end,
    external_id = coalesce(excluded.external_id, q.external_id),
    payload = case when excluded.payload = '{}'::jsonb then q.payload else excluded.payload end,
    available_at = case
      when q.status in ('processing', 'sent') then q.available_at
      else excluded.available_at
    end,
    processed_at = case
      when excluded.status = 'already_linked' then pg_catalog.now()
      when q.status in ('processing', 'sent') then q.processed_at
      else excluded.processed_at
    end,
    locked_at = case
      when excluded.status = 'already_linked' then null
      when q.status in ('processing', 'sent') then q.locked_at
      else null
    end,
    last_error = case
      when q.status in ('processing', 'sent') then q.last_error
      else null
    end,
    updated_at = pg_catalog.now()
  returning q.* into v_queue;

  return query select
    v_queue.id, v_queue.status, v_queue.provider, v_queue.action,
    v_queue.lead_id, v_queue.wa_identity_id, v_phone,
    v_queue.external_id, v_queue.blocked_reason;
end;
$$;

create or replace function public.wa_claim_crm_sync(p_queue_id uuid)
returns table (
  queue_id uuid,
  claimed boolean,
  decision text,
  lead_id bigint,
  id_empresa bigint,
  provider text,
  attempts integer
)
language plpgsql
set search_path = ''
as $$
declare
  v_queue public.wa_crm_sync_queue%rowtype;
begin
  update public.wa_crm_sync_queue q
  set status = 'processing',
      attempts = q.attempts + 1,
      locked_at = pg_catalog.now(),
      last_attempt_at = pg_catalog.now(),
      last_error = null,
      updated_at = pg_catalog.now()
  where q.id = p_queue_id
    and q.status = 'ready'
  returning q.* into v_queue;

  if found then
    return query select
      v_queue.id, true, v_queue.status, v_queue.lead_id,
      v_queue.id_empresa, v_queue.provider, v_queue.attempts;
    return;
  end if;

  select q.* into v_queue
  from public.wa_crm_sync_queue q
  where q.id = p_queue_id;

  return query select
    v_queue.id, false, coalesce(v_queue.status, 'not_found'),
    v_queue.lead_id, v_queue.id_empresa, v_queue.provider,
    coalesce(v_queue.attempts, 0);
end;
$$;

create or replace function public.wa_complete_crm_sync(
  p_queue_id uuid,
  p_id_empresa bigint,
  p_lead_id bigint,
  p_external_id text,
  p_rd_client_id text default null,
  p_id_empreendimento bigint default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_queue public.wa_crm_sync_queue%rowtype;
  v_lead public.lead%rowtype;
  v_external_id text := nullif(pg_catalog.btrim(p_external_id), '');
begin
  if v_external_id is null then
    raise exception using
      errcode = '22023',
      message = 'external_id obrigatorio para concluir sincronizacao CRM';
  end if;

  select q.* into v_queue
  from public.wa_crm_sync_queue q
  where q.id = p_queue_id
    and q.id_empresa = p_id_empresa
    and q.lead_id = p_lead_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'item da fila CRM nao encontrado';
  end if;

  if v_queue.status not in ('processing', 'sent', 'already_linked') then
    raise exception using
      errcode = '55000',
      message = 'item da fila CRM nao esta reservado para conclusao';
  end if;

  select l.* into v_lead
  from public.lead l
  where l.id = p_lead_id
    and l.id_empresa = p_id_empresa
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'lead da fila CRM nao encontrado';
  end if;

  if nullif(pg_catalog.btrim(v_lead.id_crm::text), '') is not null
     and v_lead.id_crm::text <> v_external_id then
    raise exception using
      errcode = '23505',
      message = 'lead ja possui outro id_crm';
  end if;

  update public.lead l
  set id_crm = v_external_id,
      rd_client_id = coalesce(nullif(pg_catalog.btrim(p_rd_client_id), ''), l.rd_client_id),
      id_empreendimento = coalesce(p_id_empreendimento, l.id_empreendimento),
      updated_at = pg_catalog.now()
  where l.id = p_lead_id
  returning l.* into v_lead;

  update public.wa_crm_sync_queue q
  set status = 'sent',
      external_id = v_external_id,
      blocked_reason = null,
      processed_at = pg_catalog.now(),
      locked_at = null,
      last_error = null,
      updated_at = pg_catalog.now()
  where q.id = p_queue_id;

  return pg_catalog.to_jsonb(v_lead);
end;
$$;

revoke all on function public.wa_prepare_crm_sync(bigint, bigint, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.wa_claim_crm_sync(uuid)
  from public, anon, authenticated;
revoke all on function public.wa_complete_crm_sync(uuid, bigint, bigint, text, text, bigint)
  from public, anon, authenticated;

grant execute on function public.wa_prepare_crm_sync(bigint, bigint, text, text, jsonb)
  to service_role;
grant execute on function public.wa_claim_crm_sync(uuid)
  to service_role;
grant execute on function public.wa_complete_crm_sync(uuid, bigint, bigint, text, text, bigint)
  to service_role;
