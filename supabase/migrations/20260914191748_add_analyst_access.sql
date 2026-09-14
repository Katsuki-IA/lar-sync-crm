-- Read-only, multi-company analyst access.
-- Analysts intentionally have no primary id_empresa. Their access is defined only
-- by crm_user_company_access, preventing legacy same-company write policies from
-- accidentally granting them mutations.

alter table public.crm_users
  drop constraint if exists crm_users_role_check;

alter table public.crm_users
  add constraint crm_users_role_check
  check (role = any (array[
    'super_admin'::text,
    'manager'::text,
    'agent'::text,
    'gestor'::text,
    'corretor'::text,
    'ai_agent'::text,
    'analyst'::text
  ]));

alter table public.crm_users
  add constraint crm_users_analyst_without_primary_company_check
  check (role <> 'analyst' or id_empresa is null);

create table public.crm_user_company_access (
  crm_user_id uuid not null references public.crm_users(id) on delete cascade,
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  created_by uuid null references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (crm_user_id, id_empresa)
);

create index crm_user_company_access_empresa_idx
  on public.crm_user_company_access (id_empresa, crm_user_id);

alter table public.crm_user_company_access enable row level security;

revoke all on table public.crm_user_company_access from anon, authenticated;
grant select on table public.crm_user_company_access to authenticated;
grant all on table public.crm_user_company_access to service_role;

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.crm_can_access_empresa(p_id_empresa bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.crm_users as me_row
      where me_row.auth_user_id = (select auth.uid())
        and me_row.active is true
        and (
          me_row.role = 'super_admin'
          or me_row.id_empresa = p_id_empresa
          or (
            me_row.role = 'analyst'
            and exists (
              select 1
              from public.crm_user_company_access as access
              where access.crm_user_id = me_row.id
                and access.id_empresa = p_id_empresa
            )
          )
        )
    );
$$;

revoke all on function private.crm_can_access_empresa(bigint) from public;
grant usage on schema private to authenticated;
grant execute on function private.crm_can_access_empresa(bigint) to authenticated;

create or replace function private.crm_is_current_user(p_crm_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.crm_users as me_row
      where me_row.id = p_crm_user_id
        and me_row.auth_user_id = (select auth.uid())
        and me_row.active is true
    );
$$;

create or replace function private.crm_can_view_user(p_crm_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (
      private.crm_is_current_user(p_crm_user_id)
      or exists (
        select 1
        from public.crm_users as target_user
        where target_user.id = p_crm_user_id
          and (
            private.crm_can_access_empresa(target_user.id_empresa)
            or exists (
              select 1
              from public.crm_user_company_access as target_access
              where target_access.crm_user_id = target_user.id
                and private.crm_can_access_empresa(target_access.id_empresa)
            )
          )
      )
    );
$$;

revoke all on function private.crm_is_current_user(uuid) from public;
revoke all on function private.crm_can_view_user(uuid) from public;
grant execute on function private.crm_is_current_user(uuid) to authenticated;
grant execute on function private.crm_can_view_user(uuid) to authenticated;

create policy crm_user_company_access_select
on public.crm_user_company_access
for select
to authenticated
using (
  private.crm_is_current_user(crm_user_id)
  or (
    public.crm_get_my_role() in ('manager', 'gestor', 'super_admin')
    and private.crm_can_access_empresa(id_empresa)
  )
);

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
  order by empresa.id;
$$;

revoke all on function public.crm_get_allowed_empresas() from public;
grant execute on function public.crm_get_allowed_empresas() to authenticated;

-- A user must always be able to load their own CRM profile. Managers can see
-- analysts assigned to their company; analysts can see user names used in reports.
drop policy if exists crm_users_select on public.crm_users;
create policy crm_users_select
on public.crm_users
for select
to authenticated
using (
  private.crm_can_view_user(id)
);

-- Company metadata was previously open to every role. It is now read-only for
-- authenticated users and filtered by the same company authorization function.
drop policy if exists "Allow all" on public.empresa_dados;
revoke all on table public.empresa_dados from anon, authenticated;
grant select on table public.empresa_dados to authenticated;
grant all on table public.empresa_dados to service_role;
create policy empresa_dados_select
on public.empresa_dados
for select
to authenticated
using (private.crm_can_access_empresa(id));

drop policy if exists "Allow all" on public.empreendimento;
revoke all on table public.empreendimento from anon, authenticated;
grant select on table public.empreendimento to authenticated;
grant all on table public.empreendimento to service_role;
create policy empreendimento_select
on public.empreendimento
for select
to authenticated
using (private.crm_can_access_empresa(id_empresa));

-- Add analyst-only SELECT policies alongside the existing operational policies.
create policy crm_leads_analyst_select
on public.crm_leads
for select
to authenticated
using (
  public.crm_get_my_role() = 'analyst'
  and private.crm_can_access_empresa(id_empresa)
);

create policy crm_stages_analyst_select
on public.crm_stages
for select
to authenticated
using (
  public.crm_get_my_role() = 'analyst'
  and private.crm_can_access_empresa(id_empresa)
);

create policy crm_funnels_analyst_select
on public.crm_funnels
for select
to authenticated
using (
  public.crm_get_my_role() = 'analyst'
  and private.crm_can_access_empresa(id_empresa)
);

create policy crm_tags_analyst_select
on public.crm_tags
for select
to authenticated
using (
  public.crm_get_my_role() = 'analyst'
  and private.crm_can_access_empresa(id_empresa)
);

create policy crm_lead_activities_analyst_select
on public.crm_lead_activities
for select
to authenticated
using (
  public.crm_get_my_role() = 'analyst'
  and exists (
    select 1
    from public.crm_leads as lead
    where lead.id = crm_lead_activities.lead_id
      and private.crm_can_access_empresa(lead.id_empresa)
  )
);

create policy crm_lead_tags_analyst_select
on public.crm_lead_tags
for select
to authenticated
using (
  public.crm_get_my_role() = 'analyst'
  and exists (
    select 1
    from public.crm_leads as lead
    where lead.id = crm_lead_tags.lead_id
      and private.crm_can_access_empresa(lead.id_empresa)
  )
);

-- Conversation data is readable only by authenticated users authorized for the
-- row's company. Legacy rows without id_empresa remain intentionally unavailable.
alter table public.n8n_chat_conversas enable row level security;
revoke all on table public.n8n_chat_conversas from anon, authenticated;
grant select on table public.n8n_chat_conversas to authenticated;
grant all on table public.n8n_chat_conversas to service_role;
create policy n8n_chat_conversas_company_select
on public.n8n_chat_conversas
for select
to authenticated
using (
  id_empresa is not null
  and private.crm_can_access_empresa(id_empresa)
);

drop policy if exists "Permitir select n8n" on public.n8n_chat_analises;
drop policy if exists "Permitir insert n8n" on public.n8n_chat_analises;
alter table public.n8n_chat_analises enable row level security;
revoke all on table public.n8n_chat_analises from anon, authenticated;
grant insert on table public.n8n_chat_analises to anon;
grant select on table public.n8n_chat_analises to authenticated;
grant all on table public.n8n_chat_analises to service_role;
create policy n8n_chat_analises_anon_insert
on public.n8n_chat_analises
for insert
to anon
with check (true);
create policy n8n_chat_analises_company_select
on public.n8n_chat_analises
for select
to authenticated
using (private.crm_can_access_empresa(id_empresa::bigint));

alter table public.n8n_relatorios_consolidados enable row level security;
revoke all on table public.n8n_relatorios_consolidados from anon, authenticated;
grant insert on table public.n8n_relatorios_consolidados to anon;
grant select on table public.n8n_relatorios_consolidados to authenticated;
grant all on table public.n8n_relatorios_consolidados to service_role;
create policy n8n_relatorios_consolidados_anon_insert
on public.n8n_relatorios_consolidados
for insert
to anon
with check (true);
create policy n8n_relatorios_consolidados_company_select
on public.n8n_relatorios_consolidados
for select
to authenticated
using (private.crm_can_access_empresa(id_empresa::bigint));

create index if not exists n8n_chat_conversas_empresa_created_idx
  on public.n8n_chat_conversas (id_empresa, created_at desc)
  where id_empresa is not null;

create index if not exists n8n_chat_analises_empresa_created_idx
  on public.n8n_chat_analises (id_empresa, created_at desc);

create index if not exists n8n_relatorios_consolidados_empresa_periodo_idx
  on public.n8n_relatorios_consolidados (id_empresa, periodo_inicio desc, periodo_fim desc);
