create index if not exists crm_whatsapp_connections_connected_by_idx
  on public.crm_whatsapp_connections (connected_by);

create index if not exists crm_whatsapp_phone_numbers_connection_idx
  on public.crm_whatsapp_phone_numbers (connection_id);

create index if not exists crm_whatsapp_onboarding_sessions_empresa_idx
  on public.crm_whatsapp_onboarding_sessions (id_empresa);

create index if not exists crm_whatsapp_onboarding_sessions_user_idx
  on public.crm_whatsapp_onboarding_sessions (auth_user_id);
