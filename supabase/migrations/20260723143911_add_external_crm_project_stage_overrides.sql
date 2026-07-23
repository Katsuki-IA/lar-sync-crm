create table if not exists public.crm_lead_dispatch_stage_overrides (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  id_empreendimento bigint not null references public.empreendimento(id) on delete cascade,
  external_stage_qualified_id text,
  external_stage_unqualified_id text,
  external_stage_visit_scheduled_id text,
  external_stage_lost_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id_empresa, id_empreendimento)
);

drop trigger if exists set_updated_at on public.crm_lead_dispatch_stage_overrides;
create trigger set_updated_at
before update on public.crm_lead_dispatch_stage_overrides
for each row
execute function public.handle_updated_at();

alter table public.crm_lead_dispatch_stage_overrides enable row level security;

revoke all on public.crm_lead_dispatch_stage_overrides from anon, authenticated;
grant all on public.crm_lead_dispatch_stage_overrides to service_role;
