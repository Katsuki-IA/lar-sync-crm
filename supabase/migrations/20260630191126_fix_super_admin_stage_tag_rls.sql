-- Permite que super_admin visualize as etapas e tags locais de qualquer empresa.
-- Necessário para listagem e detalhe de leads quando o usuário está navegando entre empresas.

drop policy if exists crm_stages_policy on public.crm_stages;
drop policy if exists crm_stages_select on public.crm_stages;

create policy crm_stages_select
on public.crm_stages
for select to authenticated
using (
  public.crm_get_my_role() = 'super_admin'
  or id_empresa = public.crm_get_my_empresa()
);

drop policy if exists crm_tags_policy on public.crm_tags;
drop policy if exists crm_tags_select on public.crm_tags;

create policy crm_tags_select
on public.crm_tags
for select to authenticated
using (
  public.crm_get_my_role() = 'super_admin'
  or id_empresa = public.crm_get_my_empresa()
);
