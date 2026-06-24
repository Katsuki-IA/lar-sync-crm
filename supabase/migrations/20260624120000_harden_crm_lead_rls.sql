-- Hardening de RLS para dados sensiveis do CRM.
-- Escopo intencional: leads e dados diretamente ligados a leads.
-- Nao altera tabelas compartilhadas com automacoes externas, como credentials,
-- empresa_dados e empreendimento.

create or replace function public.crm_current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from public.crm_users as u
  where u.auth_user_id = auth.uid()
    and coalesce(u.active, true) = true
  limit 1
$$;

create or replace function public.crm_current_empresa_id()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select u.id_empresa
  from public.crm_users as u
  where u.auth_user_id = auth.uid()
    and coalesce(u.active, true) = true
  limit 1
$$;

create or replace function public.crm_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role
  from public.crm_users as u
  where u.auth_user_id = auth.uid()
    and coalesce(u.active, true) = true
  limit 1
$$;

create or replace function public.crm_can_manage_empresa(p_id_empresa bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.crm_current_role() = 'super_admin'
    or (
      public.crm_current_role() = 'manager'
      and p_id_empresa = public.crm_current_empresa_id()
    ),
    false
  )
$$;

create or replace function public.crm_assignee_belongs_to_empresa(
  p_id_empresa bigint,
  p_crm_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_crm_user_id is null
    or exists (
      select 1
      from public.crm_users as u
      where u.id = p_crm_user_id
        and u.id_empresa = p_id_empresa
        and coalesce(u.active, true) = true
    )
$$;

create or replace function public.crm_stage_belongs_to_empresa(
  p_id_empresa bigint,
  p_stage_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_stage_id is null
    or exists (
      select 1
      from public.crm_stages as s
      where s.id = p_stage_id
        and s.id_empresa = p_id_empresa
    )
$$;

create or replace function public.crm_empreendimento_belongs_to_empresa(
  p_id_empresa bigint,
  p_id_empreendimento bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_id_empreendimento is null
    or exists (
      select 1
      from public.empreendimento as e
      where e.id = p_id_empreendimento
        and e.id_empresa = p_id_empresa
    )
$$;

create or replace function public.crm_can_access_lead(p_lead_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.crm_leads as l
      where l.id = p_lead_id
        and (
          public.crm_current_role() = 'super_admin'
          or (
            l.id_empresa = public.crm_current_empresa_id()
            and (
              public.crm_current_role() = 'manager'
              or l.crm_assigned_to = public.crm_current_user_id()
            )
          )
        )
    ),
    false
  )
$$;

grant execute on function public.crm_current_user_id() to authenticated;
grant execute on function public.crm_current_empresa_id() to authenticated;
grant execute on function public.crm_current_role() to authenticated;
grant execute on function public.crm_can_manage_empresa(bigint) to authenticated;
grant execute on function public.crm_assignee_belongs_to_empresa(bigint, uuid) to authenticated;
grant execute on function public.crm_stage_belongs_to_empresa(bigint, bigint) to authenticated;
grant execute on function public.crm_empreendimento_belongs_to_empresa(bigint, bigint) to authenticated;
grant execute on function public.crm_can_access_lead(bigint) to authenticated;

alter table public.crm_leads enable row level security;

drop policy if exists "crm_leads: acesso por empresa" on public.crm_leads;
drop policy if exists crm_leads_select on public.crm_leads;
drop policy if exists crm_leads_insert on public.crm_leads;
drop policy if exists crm_leads_update on public.crm_leads;
drop policy if exists crm_leads_delete on public.crm_leads;

create policy crm_leads_select
on public.crm_leads
for select to authenticated
using (
  public.crm_current_role() = 'super_admin'
  or (
    id_empresa = public.crm_current_empresa_id()
    and (
      public.crm_current_role() = 'manager'
      or crm_assigned_to = public.crm_current_user_id()
    )
  )
);

create policy crm_leads_insert
on public.crm_leads
for insert to authenticated
with check (
  public.crm_current_role() = 'super_admin'
  or (
    id_empresa = public.crm_current_empresa_id()
    and public.crm_current_role() in ('manager', 'agent')
    and (
      public.crm_current_role() = 'manager'
      or crm_assigned_to = public.crm_current_user_id()
    )
    and public.crm_assignee_belongs_to_empresa(id_empresa, crm_assigned_to)
    and public.crm_stage_belongs_to_empresa(id_empresa, crm_stage_id)
    and public.crm_empreendimento_belongs_to_empresa(id_empresa, id_empreendimento)
  )
);

create policy crm_leads_update
on public.crm_leads
for update to authenticated
using (
  public.crm_can_access_lead(id)
)
with check (
  public.crm_current_role() = 'super_admin'
  or (
    id_empresa = public.crm_current_empresa_id()
    and (
      public.crm_current_role() = 'manager'
      or (
        public.crm_current_role() = 'agent'
        and crm_assigned_to = public.crm_current_user_id()
      )
    )
    and public.crm_assignee_belongs_to_empresa(id_empresa, crm_assigned_to)
    and public.crm_stage_belongs_to_empresa(id_empresa, crm_stage_id)
    and public.crm_empreendimento_belongs_to_empresa(id_empresa, id_empreendimento)
  )
);

create policy crm_leads_delete
on public.crm_leads
for delete to authenticated
using (
  public.crm_can_access_lead(id)
);

alter table public.crm_lead_tags enable row level security;

drop policy if exists crm_lead_tags_all on public.crm_lead_tags;
drop policy if exists crm_lead_tags_select on public.crm_lead_tags;
drop policy if exists crm_lead_tags_insert on public.crm_lead_tags;
drop policy if exists crm_lead_tags_update on public.crm_lead_tags;
drop policy if exists crm_lead_tags_delete on public.crm_lead_tags;

create policy crm_lead_tags_select
on public.crm_lead_tags
for select to authenticated
using (public.crm_can_access_lead(lead_id));

create policy crm_lead_tags_insert
on public.crm_lead_tags
for insert to authenticated
with check (public.crm_can_access_lead(lead_id));

create policy crm_lead_tags_update
on public.crm_lead_tags
for update to authenticated
using (public.crm_can_access_lead(lead_id))
with check (public.crm_can_access_lead(lead_id));

create policy crm_lead_tags_delete
on public.crm_lead_tags
for delete to authenticated
using (public.crm_can_access_lead(lead_id));

alter table public.crm_lead_activities enable row level security;

drop policy if exists crm_lead_activities_all on public.crm_lead_activities;
drop policy if exists crm_lead_activities_select on public.crm_lead_activities;
drop policy if exists crm_lead_activities_insert on public.crm_lead_activities;
drop policy if exists crm_lead_activities_update on public.crm_lead_activities;
drop policy if exists crm_lead_activities_delete on public.crm_lead_activities;

create policy crm_lead_activities_select
on public.crm_lead_activities
for select to authenticated
using (public.crm_can_access_lead(lead_id));

create policy crm_lead_activities_insert
on public.crm_lead_activities
for insert to authenticated
with check (
  public.crm_can_access_lead(lead_id)
  and (
    crm_user_id is null
    or crm_user_id = public.crm_current_user_id()
    or public.crm_current_role() in ('manager', 'super_admin')
  )
);

create policy crm_lead_activities_update
on public.crm_lead_activities
for update to authenticated
using (
  public.crm_can_manage_empresa((
    select l.id_empresa from public.crm_leads as l where l.id = lead_id
  ))
  or crm_user_id = public.crm_current_user_id()
)
with check (public.crm_can_access_lead(lead_id));

create policy crm_lead_activities_delete
on public.crm_lead_activities
for delete to authenticated
using (
  public.crm_can_manage_empresa((
    select l.id_empresa from public.crm_leads as l where l.id = lead_id
  ))
  or crm_user_id = public.crm_current_user_id()
);

alter table public.crm_lead_custom_values enable row level security;

drop policy if exists crm_lead_custom_values_select on public.crm_lead_custom_values;
drop policy if exists crm_lead_custom_values_insert on public.crm_lead_custom_values;
drop policy if exists crm_lead_custom_values_update on public.crm_lead_custom_values;
drop policy if exists crm_lead_custom_values_delete on public.crm_lead_custom_values;

create policy crm_lead_custom_values_select
on public.crm_lead_custom_values
for select to authenticated
using (public.crm_can_access_lead(lead_id));

create policy crm_lead_custom_values_insert
on public.crm_lead_custom_values
for insert to authenticated
with check (
  public.crm_can_access_lead(lead_id)
  and exists (
    select 1
    from public.crm_leads as lead
    join public.crm_lead_custom_fields as field
      on field.id = crm_lead_custom_values.field_id
     and field.id_empresa = lead.id_empresa
    where lead.id = crm_lead_custom_values.lead_id
  )
);

create policy crm_lead_custom_values_update
on public.crm_lead_custom_values
for update to authenticated
using (public.crm_can_access_lead(lead_id))
with check (
  public.crm_can_access_lead(lead_id)
  and exists (
    select 1
    from public.crm_leads as lead
    join public.crm_lead_custom_fields as field
      on field.id = crm_lead_custom_values.field_id
     and field.id_empresa = lead.id_empresa
    where lead.id = crm_lead_custom_values.lead_id
  )
);

create policy crm_lead_custom_values_delete
on public.crm_lead_custom_values
for delete to authenticated
using (public.crm_can_access_lead(lead_id));

alter table public.crm_lead_tasks enable row level security;

drop policy if exists "crm_lead_tasks_select" on public.crm_lead_tasks;
drop policy if exists "crm_lead_tasks_insert" on public.crm_lead_tasks;
drop policy if exists "crm_lead_tasks_update" on public.crm_lead_tasks;
drop policy if exists "crm_lead_tasks_delete" on public.crm_lead_tasks;
drop policy if exists crm_lead_tasks_select on public.crm_lead_tasks;
drop policy if exists crm_lead_tasks_insert on public.crm_lead_tasks;
drop policy if exists crm_lead_tasks_update on public.crm_lead_tasks;
drop policy if exists crm_lead_tasks_delete on public.crm_lead_tasks;

create policy crm_lead_tasks_select
on public.crm_lead_tasks
for select to authenticated
using (
  public.crm_current_role() = 'super_admin'
  or (
    id_empresa = public.crm_current_empresa_id()
    and (
      public.crm_current_role() = 'manager'
      or assigned_to = public.crm_current_user_id()
      or created_by = public.crm_current_user_id()
      or public.crm_can_access_lead(lead_id)
    )
  )
);

create policy crm_lead_tasks_insert
on public.crm_lead_tasks
for insert to authenticated
with check (
  id_empresa = public.crm_current_empresa_id()
  and created_by = public.crm_current_user_id()
  and public.crm_can_access_lead(lead_id)
  and public.crm_assignee_belongs_to_empresa(id_empresa, assigned_to)
);

create policy crm_lead_tasks_update
on public.crm_lead_tasks
for update to authenticated
using (
  public.crm_can_manage_empresa(id_empresa)
  or assigned_to = public.crm_current_user_id()
  or created_by = public.crm_current_user_id()
)
with check (
  id_empresa = public.crm_current_empresa_id()
  and public.crm_assignee_belongs_to_empresa(id_empresa, assigned_to)
);

create policy crm_lead_tasks_delete
on public.crm_lead_tasks
for delete to authenticated
using (
  public.crm_can_manage_empresa(id_empresa)
  or created_by = public.crm_current_user_id()
);
