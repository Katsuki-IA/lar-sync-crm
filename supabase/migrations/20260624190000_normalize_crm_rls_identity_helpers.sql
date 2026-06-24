-- Mantem as funcoes antigas usadas por policies legadas alinhadas com
-- os helpers atuais de identidade do CRM.

create or replace function public.crm_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case lower(u.role)
    when 'gestor' then 'manager'
    when 'corretor' then 'agent'
    else lower(u.role)
  end
  from public.crm_users as u
  where u.auth_user_id = auth.uid()
    and coalesce(u.active, true) = true
  limit 1
$$;

create or replace function public.crm_get_my_empresa()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select public.crm_current_empresa_id()
$$;

create or replace function public.crm_get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.crm_current_role()
$$;

grant execute on function public.crm_current_role() to authenticated;
grant execute on function public.crm_get_my_empresa() to authenticated;
grant execute on function public.crm_get_my_role() to authenticated;
