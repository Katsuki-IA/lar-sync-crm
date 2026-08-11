alter table public.crm_meta_connections
  add column if not exists health_status text not null default 'unknown',
  add column if not exists last_health_check_at timestamptz,
  add column if not exists last_error text;

alter table public.crm_meta_connections
  drop constraint if exists crm_meta_connections_health_status_check;

alter table public.crm_meta_connections
  add constraint crm_meta_connections_health_status_check
  check (health_status in ('unknown', 'healthy', 'degraded', 'error'));

alter table public.crm_meta_forms
  add column if not exists webhook_subscribed boolean not null default false,
  add column if not exists webhook_checked_at timestamptz,
  add column if not exists webhook_error text,
  add column if not exists last_recovered_at timestamptz;

create unique index if not exists uq_crm_meta_configured_form_owner
  on public.crm_meta_forms (form_id, page_id)
  where active = true
    and id_empreendimento is not null
    and id_funnel is not null;

comment on index public.uq_crm_meta_configured_form_owner is
  'Impede que o mesmo formulario Meta configurado envie leads para duas empresas.';
