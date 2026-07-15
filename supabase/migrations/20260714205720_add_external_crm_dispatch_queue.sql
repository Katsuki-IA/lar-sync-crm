create table if not exists public.crm_external_dispatch_queue (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  crm_lead_id bigint not null references public.crm_leads(id) on delete cascade,
  trigger_type text not null default 'followup',
  trigger_reference text,
  scheduled_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'cancelled', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  locked_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_crm_external_dispatch_queue_active_lead
  on public.crm_external_dispatch_queue (crm_lead_id)
  where status in ('pending', 'processing');

create index if not exists idx_crm_external_dispatch_queue_pending
  on public.crm_external_dispatch_queue (status, scheduled_at)
  where status = 'pending';

create index if not exists idx_crm_external_dispatch_queue_company
  on public.crm_external_dispatch_queue (id_empresa, created_at desc);

drop trigger if exists set_crm_external_dispatch_queue_updated_at
  on public.crm_external_dispatch_queue;
create trigger set_crm_external_dispatch_queue_updated_at
before update on public.crm_external_dispatch_queue
for each row execute function public.handle_updated_at();

alter table public.crm_external_dispatch_queue enable row level security;

revoke all on table public.crm_external_dispatch_queue from anon, authenticated;
grant all on table public.crm_external_dispatch_queue to service_role;

create or replace function public.crm_enqueue_external_dispatch(
  p_id_empresa bigint,
  p_crm_lead_id bigint,
  p_scheduled_at timestamptz,
  p_trigger_type text default 'followup',
  p_trigger_reference text default null,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 3
)
returns public.crm_external_dispatch_queue
language plpgsql
set search_path = public
as $$
declare
  v_job public.crm_external_dispatch_queue;
begin
  if p_scheduled_at is null then
    raise exception 'scheduled_at e obrigatorio';
  end if;

  if not exists (
    select 1
    from public.crm_leads l
    where l.id = p_crm_lead_id
      and l.id_empresa = p_id_empresa
  ) then
    raise exception 'Lead % nao pertence a empresa %', p_crm_lead_id, p_id_empresa;
  end if;

  perform pg_advisory_xact_lock(p_crm_lead_id);

  select q.*
    into v_job
  from public.crm_external_dispatch_queue q
  where q.crm_lead_id = p_crm_lead_id
    and q.status in ('pending', 'processing')
  order by q.created_at desc
  limit 1
  for update;

  if found then
    update public.crm_external_dispatch_queue q
    set
      scheduled_at = least(q.scheduled_at, p_scheduled_at),
      trigger_type = coalesce(nullif(trim(p_trigger_type), ''), q.trigger_type),
      trigger_reference = coalesce(nullif(trim(p_trigger_reference), ''), q.trigger_reference),
      payload = coalesce(q.payload, '{}'::jsonb) || coalesce(p_payload, '{}'::jsonb),
      max_attempts = greatest(q.max_attempts, greatest(coalesce(p_max_attempts, 3), 1)),
      last_error = case when q.status = 'pending' then null else q.last_error end
    where q.id = v_job.id
    returning q.* into v_job;

    return v_job;
  end if;

  insert into public.crm_external_dispatch_queue (
    id_empresa,
    crm_lead_id,
    trigger_type,
    trigger_reference,
    scheduled_at,
    payload,
    max_attempts
  )
  values (
    p_id_empresa,
    p_crm_lead_id,
    coalesce(nullif(trim(p_trigger_type), ''), 'followup'),
    nullif(trim(p_trigger_reference), ''),
    p_scheduled_at,
    coalesce(p_payload, '{}'::jsonb),
    greatest(coalesce(p_max_attempts, 3), 1)
  )
  returning * into v_job;

  return v_job;
end;
$$;

create or replace function public.crm_claim_external_dispatch_jobs(
  p_limit integer default 20
)
returns setof public.crm_external_dispatch_queue
language plpgsql
set search_path = public
as $$
begin
  update public.crm_external_dispatch_queue
  set
    status = 'failed',
    processed_at = now(),
    locked_at = null,
    last_error = coalesce(last_error, 'Limite de tentativas atingido apos recuperacao de job travado.')
  where status = 'processing'
    and locked_at < now() - interval '15 minutes'
    and attempts >= max_attempts;

  update public.crm_external_dispatch_queue
  set
    status = 'pending',
    scheduled_at = least(scheduled_at, now()),
    locked_at = null,
    last_error = coalesce(last_error, 'Job recuperado apos timeout de processamento.')
  where status = 'processing'
    and locked_at < now() - interval '15 minutes'
    and attempts < max_attempts;

  return query
  with candidates as (
    select q.id
    from public.crm_external_dispatch_queue q
    where q.status = 'pending'
      and q.scheduled_at <= now()
      and q.attempts < q.max_attempts
    order by q.scheduled_at asc, q.created_at asc
    for update skip locked
    limit greatest(coalesce(p_limit, 20), 1)
  )
  update public.crm_external_dispatch_queue q
  set
    status = 'processing',
    locked_at = now(),
    attempts = q.attempts + 1,
    last_error = null
  from candidates c
  where q.id = c.id
  returning q.*;
end;
$$;

revoke all on function public.crm_enqueue_external_dispatch(
  bigint, bigint, timestamptz, text, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.crm_enqueue_external_dispatch(
  bigint, bigint, timestamptz, text, text, jsonb, integer
) to service_role;

revoke all on function public.crm_claim_external_dispatch_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.crm_claim_external_dispatch_jobs(integer)
  to service_role;
