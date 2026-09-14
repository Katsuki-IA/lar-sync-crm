-- Fold analyst access into the existing SELECT policies to avoid evaluating
-- multiple permissive policies for each row.

drop policy if exists crm_leads_analyst_select on public.crm_leads;
drop policy if exists crm_leads_select_empresa on public.crm_leads;
create policy crm_leads_select_empresa
on public.crm_leads
for select
to authenticated
using (
  (select auth.uid()) is not null
  and private.crm_can_access_empresa(id_empresa)
);

drop policy if exists crm_stages_analyst_select on public.crm_stages;
drop policy if exists crm_stages_select on public.crm_stages;
create policy crm_stages_select
on public.crm_stages
for select
to authenticated
using (private.crm_can_access_empresa(id_empresa));

drop policy if exists crm_tags_analyst_select on public.crm_tags;
drop policy if exists crm_tags_select on public.crm_tags;
create policy crm_tags_select
on public.crm_tags
for select
to authenticated
using (private.crm_can_access_empresa(id_empresa));

drop policy if exists crm_funnels_analyst_select on public.crm_funnels;
drop policy if exists crm_funnels_select on public.crm_funnels;
create policy crm_funnels_select
on public.crm_funnels
for select
to authenticated
using (private.crm_can_access_empresa(id_empresa));

drop policy if exists crm_lead_activities_analyst_select on public.crm_lead_activities;
drop policy if exists crm_lead_activities_select on public.crm_lead_activities;
create policy crm_lead_activities_select
on public.crm_lead_activities
for select
to authenticated
using (
  public.crm_can_access_lead(lead_id)
  or (
    public.crm_get_my_role() = 'analyst'
    and exists (
      select 1
      from public.crm_leads as lead
      where lead.id = crm_lead_activities.lead_id
        and private.crm_can_access_empresa(lead.id_empresa)
    )
  )
);

drop policy if exists crm_lead_tags_analyst_select on public.crm_lead_tags;
drop policy if exists crm_lead_tags_select on public.crm_lead_tags;
create policy crm_lead_tags_select
on public.crm_lead_tags
for select
to authenticated
using (
  public.crm_can_access_lead(lead_id)
  or (
    public.crm_get_my_role() = 'analyst'
    and exists (
      select 1
      from public.crm_leads as lead
      where lead.id = crm_lead_tags.lead_id
        and private.crm_can_access_empresa(lead.id_empresa)
    )
  )
);
