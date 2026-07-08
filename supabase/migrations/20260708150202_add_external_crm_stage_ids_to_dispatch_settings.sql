alter table public.crm_lead_dispatch_settings
  add column if not exists external_stage_qualified_id text,
  add column if not exists external_stage_visit_scheduled_id text,
  add column if not exists external_stage_lost_id text;
