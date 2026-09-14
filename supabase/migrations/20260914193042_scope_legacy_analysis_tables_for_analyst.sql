-- The legacy operational tables historically had an unrestricted "Allow all"
-- policy. Preserve anonymous automation behavior and existing authenticated CRM
-- behavior, while making the new analyst role read-only and tenant-scoped.

drop policy if exists "Allow all" on public.lead;

create policy lead_legacy_anon_all
on public.lead
for all
to anon
using (true)
with check (true);

create policy lead_legacy_authenticated_select
on public.lead
for select
to authenticated
using (
  public.crm_get_my_role() <> 'analyst'
  or private.crm_can_access_empresa(id_empresa)
);

create policy lead_legacy_authenticated_insert
on public.lead
for insert
to authenticated
with check (public.crm_get_my_role() <> 'analyst');

create policy lead_legacy_authenticated_update
on public.lead
for update
to authenticated
using (public.crm_get_my_role() <> 'analyst')
with check (public.crm_get_my_role() <> 'analyst');

create policy lead_legacy_authenticated_delete
on public.lead
for delete
to authenticated
using (public.crm_get_my_role() <> 'analyst');

drop policy if exists "Allow all" on public.agendamento;

create policy agendamento_legacy_anon_all
on public.agendamento
for all
to anon
using (true)
with check (true);

create policy agendamento_legacy_authenticated_select
on public.agendamento
for select
to authenticated
using (
  public.crm_get_my_role() <> 'analyst'
  or private.crm_can_access_empresa(id_empresa)
);

create policy agendamento_legacy_authenticated_insert
on public.agendamento
for insert
to authenticated
with check (public.crm_get_my_role() <> 'analyst');

create policy agendamento_legacy_authenticated_update
on public.agendamento
for update
to authenticated
using (public.crm_get_my_role() <> 'analyst')
with check (public.crm_get_my_role() <> 'analyst');

create policy agendamento_legacy_authenticated_delete
on public.agendamento
for delete
to authenticated
using (public.crm_get_my_role() <> 'analyst');

create policy crm_conversation_classifications_analyst_select
on public.crm_conversation_classifications
for select
to authenticated
using (
  public.crm_get_my_role() = 'analyst'
  and private.crm_can_access_empresa(id_empresa)
);
