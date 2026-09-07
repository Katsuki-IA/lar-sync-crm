-- Cover foreign keys used by joins and delete/update checks.

create index followup_sequences_v2_project_fk_idx
  on public.followup_sequences_v2 (id_empreendimento);

create index followup_dispatches_v2_enrollment_fk_idx
  on public.followup_dispatches_v2 (enrollment_id);

create index followup_dispatches_v2_sequence_fk_idx
  on public.followup_dispatches_v2 (sequence_id);

create index followup_dispatches_v2_step_fk_idx
  on public.followup_dispatches_v2 (step_id);

create index followup_dispatches_v2_variant_fk_idx
  on public.followup_dispatches_v2 (variant_id);

create index followup_dispatches_v2_project_fk_idx
  on public.followup_dispatches_v2 (id_empreendimento);
