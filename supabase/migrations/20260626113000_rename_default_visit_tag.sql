-- Atualiza a tag padrao de visita para explicitar origem IA.
-- Tambem preserva vinculos existentes caso alguma empresa ja tenha as duas tags.

insert into public.crm_lead_tags (lead_id, tag_id)
select lt.lead_id, new_tag.id
from public.crm_lead_tags lt
join public.crm_tags old_tag on old_tag.id = lt.tag_id
join public.crm_tags new_tag
  on new_tag.id_empresa = old_tag.id_empresa
 and lower(btrim(new_tag.nome)) = lower('Visita Agendada IA')
where lower(btrim(old_tag.nome)) = lower('Visita Agendada')
  and old_tag.id <> new_tag.id
on conflict do nothing;

delete from public.crm_lead_tags lt
using public.crm_tags old_tag, public.crm_tags new_tag
where lt.tag_id = old_tag.id
  and old_tag.id_empresa = new_tag.id_empresa
  and lower(btrim(old_tag.nome)) = lower('Visita Agendada')
  and lower(btrim(new_tag.nome)) = lower('Visita Agendada IA')
  and old_tag.id <> new_tag.id;

delete from public.crm_tags old_tag
using public.crm_tags new_tag
where old_tag.id_empresa = new_tag.id_empresa
  and lower(btrim(old_tag.nome)) = lower('Visita Agendada')
  and lower(btrim(new_tag.nome)) = lower('Visita Agendada IA')
  and old_tag.id <> new_tag.id;

update public.crm_tags
set nome = 'Visita Agendada IA'
where lower(btrim(nome)) = lower('Visita Agendada')
  and not exists (
    select 1
    from public.crm_tags existing
    where existing.id_empresa = crm_tags.id_empresa
      and lower(btrim(existing.nome)) = lower('Visita Agendada IA')
  );

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
    (p_id_empresa, 'Visita Agendada IA', '#8B5CF6'),
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
    perform public.crm_seed_default_tags(company.id_empresa);
  end loop;
end $$;
