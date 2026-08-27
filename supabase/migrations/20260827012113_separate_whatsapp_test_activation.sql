alter table public.crm_whatsapp_connections
  add column if not exists activation_status text not null default 'test';

alter table public.crm_whatsapp_connections
  drop constraint if exists crm_whatsapp_connections_activation_status_check;

alter table public.crm_whatsapp_connections
  add constraint crm_whatsapp_connections_activation_status_check
  check (activation_status in ('test', 'active'));

comment on column public.crm_whatsapp_connections.activation_status is
  'Separates an Embedded Signup test connection from an explicitly activated production integration.';
