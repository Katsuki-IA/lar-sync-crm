-- Fase 1 da migração para WhatsApp Business-Scoped User IDs (BSUID).
-- Versão alinhada ao registro aplicado pelo Supabase MCP em produção.
-- Esta migração é estritamente aditiva: nenhuma chave legada é alterada e
-- telefone/numero continuam obrigatórios onde já eram obrigatórios.

create table if not exists public.wa_contact_identities (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  lead_id bigint references public.lead(id) on delete set null,
  crm_lead_id bigint references public.crm_leads(id) on delete set null,
  business_phone_number_id text,
  wa_user_id text,
  wa_parent_user_id text,
  telefone text,
  username text,
  display_name text,
  conversation_key text,
  legacy_conversation_key text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wa_contact_identities_has_identifier
    check (nullif(btrim(coalesce(wa_user_id, '')), '') is not null
      or nullif(btrim(coalesce(telefone, '')), '') is not null)
);

comment on table public.wa_contact_identities is
  'Mapa aditivo entre BSUID, telefone, username e chaves de conversa do WhatsApp.';
comment on column public.wa_contact_identities.wa_user_id is
  'Business-Scoped User ID (BSUID) recebido como user_id pela API da Meta.';
comment on column public.wa_contact_identities.wa_parent_user_id is
  'Identificador parent_user_id quando fornecido pela Meta para portfólios vinculados.';
comment on column public.wa_contact_identities.conversation_key is
  'Chave canônica futura; não substitui a chave legada nesta fase.';

create unique index if not exists wa_contact_identities_empresa_user_uidx
  on public.wa_contact_identities (id_empresa, wa_user_id)
  where wa_user_id is not null and btrim(wa_user_id) <> '';

create unique index if not exists wa_contact_identities_empresa_conversation_uidx
  on public.wa_contact_identities (id_empresa, conversation_key)
  where conversation_key is not null and btrim(conversation_key) <> '';

create index if not exists wa_contact_identities_empresa_phone_idx
  on public.wa_contact_identities (id_empresa, telefone)
  where telefone is not null and btrim(telefone) <> '';

create index if not exists wa_contact_identities_lead_idx
  on public.wa_contact_identities (lead_id)
  where lead_id is not null;

create index if not exists wa_contact_identities_crm_lead_idx
  on public.wa_contact_identities (crm_lead_id)
  where crm_lead_id is not null;

drop trigger if exists set_wa_contact_identities_updated_at
  on public.wa_contact_identities;
create trigger set_wa_contact_identities_updated_at
before update on public.wa_contact_identities
for each row execute function public.handle_updated_at();

alter table public.wa_contact_identities enable row level security;
revoke all on table public.wa_contact_identities from public, anon, authenticated;
grant select, insert, update, delete on table public.wa_contact_identities to service_role;

alter table public.lead
  add column if not exists wa_user_id text,
  add column if not exists wa_parent_user_id text,
  add column if not exists wa_username text,
  add column if not exists conversation_key text,
  add column if not exists legacy_conversation_key text,
  add column if not exists wa_identity_id uuid
    references public.wa_contact_identities(id) on delete set null;

alter table public.crm_leads
  add column if not exists wa_user_id text,
  add column if not exists wa_parent_user_id text,
  add column if not exists wa_username text,
  add column if not exists conversation_key text,
  add column if not exists legacy_conversation_key text,
  add column if not exists wa_identity_id uuid
    references public.wa_contact_identities(id) on delete set null;

alter table public.wa_messages
  add column if not exists from_user_id text,
  add column if not exists to_user_id text,
  add column if not exists from_username text,
  add column if not exists to_username text,
  add column if not exists conversation_key text,
  add column if not exists legacy_conversation_key text,
  add column if not exists wa_identity_id uuid
    references public.wa_contact_identities(id) on delete set null;

alter table public.n8n_chat_conversas
  add column if not exists id_empresa bigint
    references public.empresa_dados(id) on delete cascade,
  add column if not exists telefone text,
  add column if not exists wa_user_id text,
  add column if not exists wa_username text,
  add column if not exists conversation_key text,
  add column if not exists legacy_conversation_key text,
  add column if not exists wa_identity_id uuid
    references public.wa_contact_identities(id) on delete set null;

create index if not exists lead_empresa_wa_user_idx
  on public.lead (id_empresa, wa_user_id)
  where wa_user_id is not null and btrim(wa_user_id) <> '';

create index if not exists crm_leads_empresa_wa_user_idx
  on public.crm_leads (id_empresa, wa_user_id)
  where wa_user_id is not null and btrim(wa_user_id) <> '';

create index if not exists wa_messages_conversation_key_idx
  on public.wa_messages (conversation_key)
  where conversation_key is not null and btrim(conversation_key) <> '';

create index if not exists n8n_chat_conversas_conversation_key_idx
  on public.n8n_chat_conversas (conversation_key)
  where conversation_key is not null and btrim(conversation_key) <> '';

create index if not exists lead_wa_identity_id_idx
  on public.lead (wa_identity_id)
  where wa_identity_id is not null;

create index if not exists crm_leads_wa_identity_id_idx
  on public.crm_leads (wa_identity_id)
  where wa_identity_id is not null;

create index if not exists wa_messages_wa_identity_id_idx
  on public.wa_messages (wa_identity_id)
  where wa_identity_id is not null;

create index if not exists n8n_chat_conversas_empresa_idx
  on public.n8n_chat_conversas (id_empresa)
  where id_empresa is not null;

create index if not exists n8n_chat_conversas_wa_identity_id_idx
  on public.n8n_chat_conversas (wa_identity_id)
  where wa_identity_id is not null;

comment on column public.lead.wa_user_id is
  'BSUID opcional; numero continua sendo usado como chave nesta fase.';
comment on column public.crm_leads.wa_user_id is
  'BSUID opcional; telefone continua sendo usado normalmente nesta fase.';
comment on column public.n8n_chat_conversas.numero is
  'Chave legada da memória; não é alterada pela fase 1 da migração BSUID.';
