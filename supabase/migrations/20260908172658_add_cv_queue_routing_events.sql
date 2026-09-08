alter table public.crm_lead_dispatch_settings
  add column if not exists cv_distribution_queue_without_whatsapp_id text,
  add column if not exists cv_distribution_queue_blocked_send_id text;

alter table public.crm_lead_dispatch_stage_overrides
  add column if not exists cv_distribution_queue_without_whatsapp_id text,
  add column if not exists cv_distribution_queue_blocked_send_id text;

comment on column public.crm_lead_dispatch_settings.cv_distribution_queue_without_whatsapp_id is
  'Default CV distribution queue used when a lead cannot be reached because the phone has no WhatsApp. Null disables queue distribution for this event.';

comment on column public.crm_lead_dispatch_settings.cv_distribution_queue_blocked_send_id is
  'Default CV distribution queue used after a terminal Meta delivery block. Null disables queue distribution for this event.';

comment on column public.crm_lead_dispatch_stage_overrides.cv_distribution_queue_without_whatsapp_id is
  'Optional project-specific CV queue for leads without WhatsApp. Null inherits the company default.';

comment on column public.crm_lead_dispatch_stage_overrides.cv_distribution_queue_blocked_send_id is
  'Optional project-specific CV queue for terminal Meta delivery blocks. Null inherits the company default.';
