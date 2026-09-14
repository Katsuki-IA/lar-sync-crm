-- Revocable credentials for the narrow, read-only Claude analyst connector.
-- Only a SHA-256 digest is stored; the plaintext token is shown once.
create table public.crm_analyst_connector_tokens (
  id uuid primary key default gen_random_uuid(),
  crm_user_id uuid not null references public.crm_users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  nome text not null default 'Claude',
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index crm_analyst_connector_tokens_user_idx
  on public.crm_analyst_connector_tokens (crm_user_id)
  where revoked_at is null;

alter table public.crm_analyst_connector_tokens enable row level security;

revoke all on table public.crm_analyst_connector_tokens from public, anon, authenticated;
grant all on table public.crm_analyst_connector_tokens to service_role;

create policy crm_analyst_connector_tokens_service_role
on public.crm_analyst_connector_tokens
for all
to service_role
using (true)
with check (true);

comment on table public.crm_analyst_connector_tokens is
  'Hashed, revocable credentials used only by the read-only analyst MCP endpoint.';
