alter table public.fila_leads enable row level security;

grant select, insert on public.fila_leads to authenticated;
grant usage, select on sequence public.fila_leads_id_seq to authenticated;

drop policy if exists fila_leads_select_crm_empresa on public.fila_leads;
create policy fila_leads_select_crm_empresa
on public.fila_leads
for select to authenticated
using (
  id_empresa = public.crm_current_empresa_id()
  or public.crm_current_role() = 'super_admin'
);

drop policy if exists fila_leads_insert_crm_empresa on public.fila_leads;
create policy fila_leads_insert_crm_empresa
on public.fila_leads
for insert to authenticated
with check (
  (
    id_empresa = public.crm_current_empresa_id()
    or public.crm_current_role() = 'super_admin'
  )
  and public.crm_empreendimento_belongs_to_empresa(id_empresa, id_empreendimento)
  and coalesce(crm_provider, '') = 'Hub'
  and coalesce(id_lead, '') ~ '^[0-9]+$'
  and exists (
    select 1
    from public.crm_leads as lead
    where lead.id = id_lead::bigint
      and lead.id_empresa = fila_leads.id_empresa
  )
);
