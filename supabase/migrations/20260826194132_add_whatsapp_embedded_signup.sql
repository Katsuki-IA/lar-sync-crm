create table if not exists public.crm_whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  business_id text,
  waba_id text not null,
  business_name text,
  access_token_ciphertext text not null,
  registration_pin_ciphertext text,
  token_expires_at timestamptz,
  status text not null default 'connected',
  activation_status text not null default 'test',
  webhook_subscribed boolean not null default false,
  phone_registered boolean not null default false,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  last_health_check_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_whatsapp_connections_status_check
    check (status in ('connected', 'attention', 'disconnected', 'error')),
  constraint crm_whatsapp_connections_activation_status_check
    check (activation_status in ('test', 'active')),
  constraint crm_whatsapp_connections_empresa_key unique (id_empresa)
);

create unique index if not exists crm_whatsapp_connections_active_waba_key
  on public.crm_whatsapp_connections (waba_id)
  where status <> 'disconnected';

create index if not exists crm_whatsapp_connections_connected_by_idx
  on public.crm_whatsapp_connections (connected_by);

create table if not exists public.crm_whatsapp_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.crm_whatsapp_connections(id) on delete cascade,
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  phone_number_id text not null,
  display_phone_number text,
  verified_name text,
  quality_rating text,
  code_verification_status text,
  name_status text,
  platform_status text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_whatsapp_phone_numbers_empresa_phone_key
    unique (id_empresa, phone_number_id)
);

create unique index if not exists crm_whatsapp_phone_numbers_active_phone_key
  on public.crm_whatsapp_phone_numbers (phone_number_id)
  where active = true;

create index if not exists crm_whatsapp_phone_numbers_connection_idx
  on public.crm_whatsapp_phone_numbers (connection_id);

create table if not exists public.crm_whatsapp_onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists crm_whatsapp_onboarding_sessions_lookup_idx
  on public.crm_whatsapp_onboarding_sessions (id, id_empresa, auth_user_id, expires_at);

create index if not exists crm_whatsapp_onboarding_sessions_empresa_idx
  on public.crm_whatsapp_onboarding_sessions (id_empresa);

create index if not exists crm_whatsapp_onboarding_sessions_user_idx
  on public.crm_whatsapp_onboarding_sessions (auth_user_id);

alter table public.crm_whatsapp_connections enable row level security;
alter table public.crm_whatsapp_phone_numbers enable row level security;
alter table public.crm_whatsapp_onboarding_sessions enable row level security;

revoke all on table public.crm_whatsapp_connections from anon, authenticated;
revoke all on table public.crm_whatsapp_phone_numbers from anon, authenticated;
revoke all on table public.crm_whatsapp_onboarding_sessions from anon, authenticated;

comment on table public.crm_whatsapp_connections is
  'Server-only WhatsApp Embedded Signup connection for each Hub company.';
comment on column public.crm_whatsapp_connections.access_token_ciphertext is
  'Business token encrypted by the Edge Function with AES-GCM.';
comment on column public.crm_whatsapp_connections.registration_pin_ciphertext is
  'WhatsApp two-step verification PIN encrypted by the Edge Function with AES-GCM.';
comment on table public.crm_whatsapp_onboarding_sessions is
  'Short-lived, one-time sessions that bind Embedded Signup to the authenticated company.';
