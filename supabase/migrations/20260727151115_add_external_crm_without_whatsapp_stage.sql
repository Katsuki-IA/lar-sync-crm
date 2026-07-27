alter table public.crm_lead_dispatch_settings
  add column if not exists external_stage_without_whatsapp_id text;

alter table public.crm_lead_dispatch_stage_overrides
  add column if not exists external_stage_without_whatsapp_id text;
