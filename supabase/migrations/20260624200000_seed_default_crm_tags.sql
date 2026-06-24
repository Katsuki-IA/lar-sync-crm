-- Tags padrao do CRM Katsuki.
-- Garante uma tag por empresa/nome normalizado para evitar duplicidade em fluxos externos.

create unique index if not exists crm_tags_empresa_nome_normalized_key
on public.crm_tags (id_empresa, lower(btrim(nome)));

create or replace function public.crm_seed_default_tags(p_id_empresa bigint)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.crm_tags (id_empresa, nome, cor)
  values
    (p_id_empresa, 'Atendimento IA', '#F97316'),
    (p_id_empresa, 'Bloqueio IA', '#EF4444'),
    (p_id_empresa, 'Cliente Respondeu', '#22C55E'),
    (p_id_empresa, 'Visita Agendada', '#8B5CF6'),
    (p_id_empresa, 'FUP1', '#0EA5E9'),
    (p_id_empresa, 'FUP2', '#0284C7'),
    (p_id_empresa, 'FUP3', '#2563EB'),
    (p_id_empresa, 'FUP4', '#1D4ED8'),
    (p_id_empresa, 'Qualificado', '#16A34A'),
    (p_id_empresa, 'Desqualificado', '#DC2626'),
    (p_id_empresa, 'Perdido', '#991B1B'),
    (p_id_empresa, 'Sem Whatsapp', '#64748B')
  on conflict (id_empresa, lower(btrim(nome))) do nothing
$$;

grant execute on function public.crm_seed_default_tags(bigint) to authenticated;
grant execute on function public.crm_seed_default_tags(bigint) to service_role;

create or replace function public.crm_seed_defaults_on_credentials()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.default_crm = 'katsuki' and new.id_empresa is not null then
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
    where default_crm = 'katsuki'
      and id_empresa is not null
  loop
    perform public.crm_seed_default_tags(company.id_empresa);
  end loop;
end $$;
