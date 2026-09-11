create or replace view public.crm_meta_connections_monitor
with (security_invoker = true)
as
select
  connection.id,
  connection.id_empresa,
  connection.connected_at,
  connection.active,
  connection.health_status,
  connection.last_health_check_at,
  connection.last_error,
  connection.token_expires_at,
  connection.token_data_access_expires_at,
  connection.token_last_validated_at,
  connection.token_validation_error
from public.crm_meta_connections as connection
where connection.active = true
  and exists (
  select 1
  from public.credentials as company_credentials
  where company_credentials.id_empresa = connection.id_empresa
    and company_credentials.default_crm = 'hub'
);

comment on view public.crm_meta_connections_monitor is
  'Leitura segura das conexoes Meta ativas no CRM Hub, sem tokens de acesso.';

revoke all on table public.crm_meta_connections_monitor from public, anon, authenticated;
grant select on table public.crm_meta_connections_monitor to service_role;
