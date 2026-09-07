-- Registra sincronizacoes de contatos WhatsApp com CRMs externos sem transformar
-- ausencia de telefone em erro tecnico. Esta fila e independente do CRM Hub e
-- aceita o lead legado da automacao como origem.

create table if not exists public.wa_crm_sync_queue (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  lead_id bigint not null references public.lead(id) on delete cascade,
  wa_identity_id uuid references public.wa_contact_identities(id) on delete set null,
  provider text not null,
  action text not null default 'create_lead',
  status text not null default 'waiting_phone',
  blocked_reason text,
  external_id text,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  available_at timestamptz,
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wa_crm_sync_queue_provider_not_blank
    check (nullif(btrim(provider), '') is not null),
  constraint wa_crm_sync_queue_action_not_blank
    check (nullif(btrim(action), '') is not null),
  constraint wa_crm_sync_queue_status_check
    check (status in (
      'waiting_phone',
      'ready',
      'processing',
      'sent',
      'failed',
      'cancelled',
      'already_linked'
    )),
  constraint wa_crm_sync_queue_attempts_check check (attempts >= 0),
  constraint wa_crm_sync_queue_lead_provider_action_key
    unique (id_empresa, lead_id, provider, action)
);

create index if not exists wa_crm_sync_queue_pending_idx
  on public.wa_crm_sync_queue (status, available_at, created_at)
  where status in ('waiting_phone', 'ready', 'failed');

create index if not exists wa_crm_sync_queue_identity_idx
  on public.wa_crm_sync_queue (id_empresa, wa_identity_id)
  where wa_identity_id is not null;

comment on table public.wa_crm_sync_queue is
  'Estado duravel da sincronizacao entre contatos WhatsApp e o CRM externo configurado para a empresa.';
comment on column public.wa_crm_sync_queue.status is
  'waiting_phone nao e falha e nao deve ser reprocessado ate o telefone ficar disponivel.';

alter table public.wa_crm_sync_queue enable row level security;

revoke all on table public.wa_crm_sync_queue from public, anon, authenticated;
grant select, insert, update, delete on table public.wa_crm_sync_queue to service_role;

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
security invoker
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
    id_empresa,
    lead_id,
    wa_identity_id,
    provider,
    action,
    status,
    blocked_reason,
    external_id,
    payload,
    available_at,
    processed_at,
    last_error,
    updated_at
  ) values (
    p_id_empresa,
    p_lead_id,
    v_lead.wa_identity_id,
    v_provider,
    v_action,
    v_status,
    v_reason,
    nullif(pg_catalog.btrim(v_lead.id_crm::text), ''),
    coalesce(p_payload, '{}'::jsonb),
    case when v_status = 'ready' then pg_catalog.now() else null end,
    case when v_status = 'already_linked' then pg_catalog.now() else null end,
    null,
    pg_catalog.now()
  )
  on conflict on constraint wa_crm_sync_queue_lead_provider_action_key
  do update set
    wa_identity_id = coalesce(excluded.wa_identity_id, q.wa_identity_id),
    status = excluded.status,
    blocked_reason = excluded.blocked_reason,
    external_id = coalesce(excluded.external_id, q.external_id),
    payload = case
      when excluded.payload = '{}'::jsonb then q.payload
      else excluded.payload
    end,
    available_at = excluded.available_at,
    processed_at = excluded.processed_at,
    locked_at = null,
    last_error = null,
    updated_at = pg_catalog.now()
  returning q.* into v_queue;

  return query
  select
    v_queue.id,
    v_queue.status,
    v_queue.provider,
    v_queue.action,
    v_queue.lead_id,
    v_queue.wa_identity_id,
    v_phone,
    v_queue.external_id,
    v_queue.blocked_reason;
end;
$$;

comment on function public.wa_prepare_crm_sync(bigint, bigint, text, text, jsonb) is
  'Preflight idempotente: distingue lead pronto, ja vinculado ou aguardando telefone antes de chamar CRM externo.';

revoke all on function public.wa_prepare_crm_sync(bigint, bigint, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.wa_prepare_crm_sync(bigint, bigint, text, text, jsonb)
  to service_role;

create or replace function public.wa_release_crm_sync_when_phone_arrives()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old_phone text;
  v_new_phone text;
begin
  v_old_phone := nullif(
    pg_catalog.regexp_replace(coalesce(old.numero::text, ''), '[^0-9]', '', 'g'),
    ''
  );
  v_new_phone := nullif(
    pg_catalog.regexp_replace(coalesce(new.numero::text, ''), '[^0-9]', '', 'g'),
    ''
  );

  if v_old_phone is null and v_new_phone is not null then
    update public.wa_crm_sync_queue q
    set status = case
          when nullif(pg_catalog.btrim(new.id_crm::text), '') is not null
            then 'already_linked'
          else 'ready'
        end,
        blocked_reason = null,
        external_id = coalesce(
          nullif(pg_catalog.btrim(new.id_crm::text), ''),
          q.external_id
        ),
        available_at = case
          when nullif(pg_catalog.btrim(new.id_crm::text), '') is null
            then pg_catalog.now()
          else null
        end,
        processed_at = case
          when nullif(pg_catalog.btrim(new.id_crm::text), '') is not null
            then pg_catalog.now()
          else null
        end,
        locked_at = null,
        last_error = null,
        updated_at = pg_catalog.now()
    where q.lead_id = new.id
      and q.id_empresa = new.id_empresa
      and q.status = 'waiting_phone';
  end if;

  return new;
end;
$$;

revoke all on function public.wa_release_crm_sync_when_phone_arrives()
  from public, anon, authenticated;
grant execute on function public.wa_release_crm_sync_when_phone_arrives()
  to service_role;

drop trigger if exists trg_wa_release_crm_sync_when_phone_arrives on public.lead;
create trigger trg_wa_release_crm_sync_when_phone_arrives
after update of numero on public.lead
for each row
execute function public.wa_release_crm_sync_when_phone_arrives();
