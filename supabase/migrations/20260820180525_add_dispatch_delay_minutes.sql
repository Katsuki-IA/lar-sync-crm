alter table public.crm_lead_dispatch_settings
  add column if not exists dispatch_delay_minutes integer not null default 60;

update public.crm_lead_dispatch_settings
set dispatch_delay_minutes = 60
where dispatch_delay_minutes is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'crm_lead_dispatch_settings_delay_minutes_check'
      and conrelid = 'public.crm_lead_dispatch_settings'::regclass
  ) then
    alter table public.crm_lead_dispatch_settings
      add constraint crm_lead_dispatch_settings_delay_minutes_check
      check (dispatch_delay_minutes between 0 and 10080);
  end if;
end
$$;

comment on column public.crm_lead_dispatch_settings.dispatch_delay_minutes is
  'Tempo por empresa, em minutos, entre o gatilho de follow-up e o envio ao CRM externo. Padrão: 60 minutos.';
