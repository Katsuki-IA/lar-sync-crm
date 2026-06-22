create table if not exists public.crm_rd_source_mappings (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  connection_id uuid not null references public.crm_rd_connections(id) on delete cascade,
  event_identifier text not null,
  id_empreendimento bigint references public.empreendimento(id) on delete set null,
  active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id_empresa, event_identifier)
);

create index if not exists idx_crm_rd_source_mappings_connection
on public.crm_rd_source_mappings (connection_id, active);

alter table public.crm_rd_events
  add column if not exists source_mapping_id uuid
    references public.crm_rd_source_mappings(id) on delete set null,
  add column if not exists id_empreendimento bigint
    references public.empreendimento(id) on delete set null;

alter table public.crm_rd_events
  drop constraint if exists crm_rd_events_status_check;

alter table public.crm_rd_events
  add constraint crm_rd_events_status_check
  check (status in ('received', 'pending_mapping', 'processed', 'failed', 'ignored'));

insert into public.crm_rd_source_mappings (
  id_empresa,
  connection_id,
  event_identifier,
  id_empreendimento,
  last_seen_at
)
select
  event.id_empresa,
  connection.id,
  event.event_identifier,
  connection.default_id_empreendimento,
  max(event.received_at)
from public.crm_rd_events event
join public.crm_rd_connections connection
  on connection.id_empresa = event.id_empresa
where event.event_identifier is not null
  and btrim(event.event_identifier) <> ''
group by
  event.id_empresa,
  connection.id,
  event.event_identifier,
  connection.default_id_empreendimento
on conflict (id_empresa, event_identifier) do nothing;

update public.crm_rd_events event
set
  source_mapping_id = mapping.id,
  id_empreendimento = coalesce(event.id_empreendimento, mapping.id_empreendimento)
from public.crm_rd_source_mappings mapping
where mapping.id_empresa = event.id_empresa
  and mapping.event_identifier = event.event_identifier
  and event.source_mapping_id is null;

drop trigger if exists set_crm_rd_source_mappings_updated_at
on public.crm_rd_source_mappings;
create trigger set_crm_rd_source_mappings_updated_at
before update on public.crm_rd_source_mappings
for each row execute function public.handle_updated_at();

alter table public.crm_rd_source_mappings enable row level security;
revoke all on public.crm_rd_source_mappings from anon, authenticated;
grant all on public.crm_rd_source_mappings to service_role;

comment on table public.crm_rd_source_mappings is
'Vínculo entre um identificador de conversão do RD Station e um empreendimento do CRM.';

comment on column public.crm_rd_events.id_empreendimento is
'Empreendimento aplicado no momento do processamento do evento.';
