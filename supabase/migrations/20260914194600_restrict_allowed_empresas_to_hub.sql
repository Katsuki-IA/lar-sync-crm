-- Keep the company selector aligned with the HUB product. Authorization is
-- still enforced independently by private.crm_can_access_empresa.
create or replace function public.crm_get_allowed_empresas()
returns setof bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select empresa.id
  from public.empresa_dados as empresa
  where private.crm_can_access_empresa(empresa.id)
    and exists (
      select 1
      from public.credentials as credential
      where credential.id_empresa = empresa.id
        and credential.default_crm = 'hub'
    )
  order by empresa.id;
$$;

revoke all on function public.crm_get_allowed_empresas() from public;
grant execute on function public.crm_get_allowed_empresas() to authenticated;
