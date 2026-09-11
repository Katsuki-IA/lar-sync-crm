create table if not exists public.crm_meta_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  leadgen_id text not null,
  page_id text not null,
  form_id text not null,
  entry_id text,
  entry_time bigint,
  id_empresa bigint,
  crm_lead_id bigint,
  status text not null default 'received'
    check (status in ('received', 'processed', 'ignored', 'failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.crm_meta_webhook_receipts enable row level security;

create index if not exists crm_meta_webhook_receipts_lead_created_idx
  on public.crm_meta_webhook_receipts (leadgen_id, received_at desc);

create index if not exists crm_meta_webhook_receipts_page_created_idx
  on public.crm_meta_webhook_receipts (page_id, received_at desc);

comment on table public.crm_meta_webhook_receipts is
  'Auditoria mínima dos webhooks leadgen recebidos, registrada antes do processamento do lead.';

revoke all on table public.crm_meta_webhook_receipts from public, anon, authenticated;

create or replace view public.crm_meta_recovery_alerts_monitor
with (security_invoker = true)
as
select
  event.id,
  event.id_empresa,
  company.nome as company_name,
  event.message,
  event.details,
  event.created_at
from public.crm_meta_connection_events as event
join public.empresa_dados as company
  on company.id = event.id_empresa
where event.event_type = 'leads_recovered'
  and event.created_at >= now() - interval '7 days'
  and exists (
    select 1
    from public.credentials as company_credentials
    where company_credentials.id_empresa = event.id_empresa
      and company_credentials.default_crm = 'hub'
  );

comment on view public.crm_meta_recovery_alerts_monitor is
  'Eventos recentes de leads Meta recuperados para alerta externo, sem tokens ou dados pessoais.';

revoke all on table public.crm_meta_recovery_alerts_monitor from public, anon, authenticated;
grant select on table public.crm_meta_recovery_alerts_monitor to service_role;

do $migration$
declare
  recovery_job_id bigint;
begin
  select jobid
    into recovery_job_id
  from cron.job
  where jobname = 'meta-leads-daily-recovery'
  limit 1;

  if recovery_job_id is null then
    raise exception 'Cron job meta-leads-daily-recovery not found';
  end if;

  -- pg_cron usa UTC: 11h, 15h e 23h correspondem a 8h, 12h e 20h em Brasília.
  perform cron.alter_job(
    job_id := recovery_job_id,
    schedule := '0 11,15,23 * * *'
  );
end
$migration$;
