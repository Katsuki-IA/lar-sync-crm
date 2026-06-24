alter table public.crm_users
  drop constraint if exists crm_users_role_check;

alter table public.crm_users
  add constraint crm_users_role_check
  check (role in ('super_admin', 'manager', 'agent', 'gestor', 'corretor', 'ai_agent'));
