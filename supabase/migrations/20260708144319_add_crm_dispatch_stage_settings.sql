create table if not exists public.crm_lead_dispatch_settings (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  stage_without_contact_id bigint references public.crm_stages(id) on delete set null,
  stage_with_contact_id bigint references public.crm_stages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id_empresa)
);

create index if not exists idx_crm_lead_dispatch_settings_empresa
  on public.crm_lead_dispatch_settings (id_empresa);

drop trigger if exists set_updated_at on public.crm_lead_dispatch_settings;
create trigger set_updated_at
before update on public.crm_lead_dispatch_settings
for each row
execute function public.handle_updated_at();

alter table public.crm_lead_dispatch_settings enable row level security;

revoke all on public.crm_lead_dispatch_settings from anon, authenticated;
grant all on public.crm_lead_dispatch_settings to service_role;
