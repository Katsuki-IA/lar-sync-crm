alter table public.crm_lead_dispatch_settings
  add column if not exists external_stage_unqualified_id text;
