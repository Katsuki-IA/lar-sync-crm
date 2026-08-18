alter table public.crm_external_crm_connections
  drop constraint if exists crm_external_crm_connections_provider_check;

alter table public.crm_external_crm_connections
  add constraint crm_external_crm_connections_provider_check
  check (
    provider in (
      'rd_station',
      'cv_crm',
      'c2s',
      'kommo',
      'loft',
      'custom',
      'katsuki_crm'
    )
  );

comment on column public.crm_external_crm_connections.access_token is
  'Credencial secreta do CRM externo. Nunca retornar este valor para o cliente.';
