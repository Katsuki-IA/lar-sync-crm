create index if not exists followup_crm_events_v2_company_idx
  on public.followup_crm_events_v2 (id_empresa);

create index if not exists followup_crm_events_v2_dispatch_idx
  on public.followup_crm_events_v2 (dispatch_id);

create index if not exists followup_crm_events_v2_wa_message_idx
  on public.followup_crm_events_v2 (wa_message_id);
