create table if not exists public.crm_whatsapp_review_events (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  connection_id uuid references public.crm_whatsapp_connections(id) on delete cascade,
  phone_number_id text,
  source text not null,
  event_type text not null,
  event_key text not null,
  message_id text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint crm_whatsapp_review_events_source_check
    check (source in ('hub', 'webhook')),
  constraint crm_whatsapp_review_events_event_key_key unique (event_key)
);

create index if not exists crm_whatsapp_review_events_empresa_occurred_idx
  on public.crm_whatsapp_review_events (id_empresa, occurred_at desc);

create index if not exists crm_whatsapp_review_events_phone_occurred_idx
  on public.crm_whatsapp_review_events (phone_number_id, occurred_at desc)
  where phone_number_id is not null;

create index if not exists crm_whatsapp_review_events_message_idx
  on public.crm_whatsapp_review_events (message_id)
  where message_id is not null;

alter table public.crm_whatsapp_review_events enable row level security;
revoke all on table public.crm_whatsapp_review_events from public, anon, authenticated;
grant select, insert, update, delete on table public.crm_whatsapp_review_events to service_role;

comment on table public.crm_whatsapp_review_events is
  'Server-only audit trail for the Meta App Review WhatsApp test environment.';
