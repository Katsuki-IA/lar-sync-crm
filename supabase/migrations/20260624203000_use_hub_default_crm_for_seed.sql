-- O CRM atual usa credentials.default_crm = 'hub'.
-- Mantem o seed automatico de funis/etapas/tags alinhado a esse valor.

create or replace function public.crm_seed_defaults_on_credentials()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.default_crm = 'hub' and new.id_empresa is not null then
    perform public.crm_seed_default_stages(new.id_empresa);
    perform public.crm_seed_default_tags(new.id_empresa);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_crm_seed_stages_on_credentials on public.credentials;
drop trigger if exists trg_crm_seed_defaults_on_credentials on public.credentials;

create trigger trg_crm_seed_defaults_on_credentials
after insert or update of default_crm, id_empresa on public.credentials
for each row execute function public.crm_seed_defaults_on_credentials();

do $$
declare
  company record;
begin
  for company in
    select distinct id_empresa
    from public.credentials
    where default_crm = 'hub'
      and id_empresa is not null
  loop
    perform public.crm_seed_default_stages(company.id_empresa);
    perform public.crm_seed_default_tags(company.id_empresa);
  end loop;
end $$;
