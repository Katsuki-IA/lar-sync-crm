create table if not exists public.crm_rd_connections (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  platform_account_id text,
  webhook_uuid text,
  webhook_secret_hash text,
  default_id_empreendimento bigint references public.empreendimento(id) on delete set null,
  connected_at timestamptz not null default now(),
  active boolean not null default true,
  last_event_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id_empresa)
);

create unique index if not exists uq_crm_rd_connections_webhook_secret
on public.crm_rd_connections (webhook_secret_hash)
where webhook_secret_hash is not null;

create table if not exists public.crm_rd_events (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  connection_id uuid references public.crm_rd_connections(id) on delete set null,
  event_key text not null,
  event_type text not null,
  event_identifier text,
  event_timestamp timestamptz,
  contact_uuid text,
  contact_email text,
  crm_lead_id bigint references public.crm_leads(id) on delete set null,
  status text not null default 'received'
    check (status in ('received', 'processed', 'failed', 'ignored')),
  error text,
  raw_data jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (id_empresa, event_key)
);

create index if not exists idx_crm_rd_events_empresa_received
on public.crm_rd_events (id_empresa, received_at desc);

create index if not exists idx_crm_rd_events_contact
on public.crm_rd_events (id_empresa, contact_uuid)
where contact_uuid is not null;

drop trigger if exists set_crm_rd_connections_updated_at
on public.crm_rd_connections;
create trigger set_crm_rd_connections_updated_at
before update on public.crm_rd_connections
for each row execute function public.handle_updated_at();

alter table public.crm_rd_connections enable row level security;
alter table public.crm_rd_events enable row level security;

revoke all on public.crm_rd_connections from anon, authenticated;
revoke all on public.crm_rd_events from anon, authenticated;

grant all on public.crm_rd_connections to service_role;
grant all on public.crm_rd_events to service_role;

comment on table public.crm_rd_connections is
'Conexões OAuth do RD Station Marketing, uma por empresa do CRM.';

comment on table public.crm_rd_events is
'Log idempotente dos webhooks de conversão recebidos do RD Station Marketing.';
