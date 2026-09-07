create index if not exists followup_completion_events_v2_enrollment_idx
  on public.followup_completion_events_v2 (enrollment_id);

create index if not exists followup_completion_events_v2_lead_idx
  on public.followup_completion_events_v2 (lead_id);

create index if not exists followup_completion_events_v2_policy_idx
  on public.followup_completion_events_v2 (policy_id);

create index if not exists followup_completion_events_v2_sequence_idx
  on public.followup_completion_events_v2 (sequence_id);
