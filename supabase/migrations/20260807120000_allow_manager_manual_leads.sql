-- Permite que gestores criem leads manuais somente na propria empresa.

drop policy if exists crm_leads_insert on public.crm_leads;
create policy crm_leads_insert on public.crm_leads
for insert to authenticated
with check (
  (
    public.crm_current_role() = 'super_admin'
    or (
      public.crm_current_role() = 'manager'
      and id_empresa = public.crm_current_empresa_id()
    )
  )
  and public.crm_assignee_belongs_to_empresa(id_empresa, crm_assigned_to)
  and public.crm_stage_belongs_to_empresa(id_empresa, crm_stage_id)
  and public.crm_empreendimento_belongs_to_empresa(id_empresa, id_empreendimento)
);

drop policy if exists crm_lead_activities_insert on public.crm_lead_activities;
create policy crm_lead_activities_insert on public.crm_lead_activities
for insert to authenticated
with check (
  public.crm_current_role() = 'super_admin'
  or (
    public.crm_current_role() = 'manager'
    and public.crm_can_access_lead(lead_id)
    and crm_user_id = public.crm_current_user_id()
  )
);

drop policy if exists crm_lead_custom_values_insert on public.crm_lead_custom_values;
create policy crm_lead_custom_values_insert on public.crm_lead_custom_values
for insert to authenticated
with check (
  public.crm_current_role() = 'super_admin'
  or (
    public.crm_current_role() = 'manager'
    and public.crm_can_access_lead(lead_id)
    and exists (
      select 1
      from public.crm_leads as lead
      join public.crm_lead_custom_fields as field
        on field.id = crm_lead_custom_values.field_id
       and field.id_empresa = lead.id_empresa
      where lead.id = crm_lead_custom_values.lead_id
    )
  )
);
