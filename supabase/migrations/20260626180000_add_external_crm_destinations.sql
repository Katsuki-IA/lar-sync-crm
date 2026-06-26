create table if not exists public.crm_external_crm_connections (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  provider text not null,
  provider_label text not null,
  account_id text,
  account_name text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  settings jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  connected_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_external_crm_connections_provider_check
    check (provider in ('rd_station', 'cv_crm', 'c2s', 'kommo', 'loft', 'custom')),
  unique (id_empresa, provider)
);

create table if not exists public.crm_external_crm_send_logs (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  lead_id bigint references public.crm_leads(id) on delete set null,
  connection_id uuid references public.crm_external_crm_connections(id) on delete set null,
  provider text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  external_id text,
  request_payload jsonb,
  response_payload jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_external_crm_connections_empresa
on public.crm_external_crm_connections (id_empresa, provider, active);

create index if not exists idx_crm_external_crm_send_logs_lead
on public.crm_external_crm_send_logs (lead_id, created_at desc);

create index if not exists idx_crm_external_crm_send_logs_empresa
on public.crm_external_crm_send_logs (id_empresa, created_at desc);

drop trigger if exists set_crm_external_crm_connections_updated_at
on public.crm_external_crm_connections;
create trigger set_crm_external_crm_connections_updated_at
before update on public.crm_external_crm_connections
for each row execute function public.handle_updated_at();

alter table public.crm_external_crm_connections enable row level security;
alter table public.crm_external_crm_send_logs enable row level security;

revoke all on public.crm_external_crm_connections from anon, authenticated;
revoke all on public.crm_external_crm_send_logs from anon, authenticated;

grant all on public.crm_external_crm_connections to service_role;
grant all on public.crm_external_crm_send_logs to service_role;

comment on table public.crm_external_crm_connections is
'Conexões de destino para envio de leads a CRMs externos. Tokens são acessados somente por Edge Functions via service role.';

comment on table public.crm_external_crm_send_logs is
'Log de tentativas de envio de leads do HUB para CRMs externos.';
