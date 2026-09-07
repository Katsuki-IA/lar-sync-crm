create or replace function public.followup_dispatch_validation_v2(p_dispatch_id bigint)
returns text
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_reason text;
begin
  select case
    when d.dry_run then 'dry_run_dispatch'
    when public.followup_engine_mode_v2(d.id_empresa) <> 'v2' then 'engine_not_v2'
    when seq.status <> 'active' then 'sequence_not_active'
    when enr.status <> 'active' then 'enrollment_not_active'
    when enr.next_step_order <> st.step_order then 'enrollment_step_changed'
    when coalesce(l.atendimento_humano, false) then 'human_service_active'
    when l.status not in ('ativo', 'agendando') then 'lead_status_changed'
    when exists (
      select 1
      from public.agendamento a
      where a.id_lead = l.id
        and a.deleted_at is null
    ) then 'appointment_exists'
    when public.followup_try_timestamptz_v2(l.ult_message)
         is distinct from public.followup_try_timestamptz_v2(d.context_snapshot ->> 'last_message_at')
      then 'last_message_changed'
    when public.followup_context_v2(l.status, l.qtd_interacoes) <> d.conversation_context
      then 'conversation_context_changed'
    when coalesce(l.empreendimento_em_foco_id, l.id_empreendimento)
         is distinct from d.id_empreendimento
      then 'project_changed'
    when st.step_order > 1
      and not public.followup_within_send_window_v2(
        seq.timezone,
        seq.send_window_start,
        seq.send_window_end,
        now()
      )
      then 'outside_send_window'
    else null
  end
  into v_reason
  from public.followup_dispatches_v2 d
  join public.followup_sequences_v2 seq on seq.id = d.sequence_id
  join public.followup_steps_v2 st on st.id = d.step_id
  join public.followup_enrollments_v2 enr on enr.id = d.enrollment_id
  join public.lead l on l.id = d.lead_id
  where d.id = p_dispatch_id;

  if not found then
    return 'dispatch_not_found';
  end if;

  return v_reason;
end;
$function$;

comment on function public.followup_dispatch_validation_v2(bigint) is
  'Validates a queued V2 dispatch. Step 1 may send at any time; later steps must be within the sequence send window.';
