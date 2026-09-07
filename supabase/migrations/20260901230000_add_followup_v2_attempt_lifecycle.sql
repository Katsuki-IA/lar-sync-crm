-- Follow-ups V2: transport ledger and attempt lifecycle for an inactive worker.
-- No scheduler or external HTTP call is created here.

alter table public.wa_messages
  drop constraint if exists wa_messages_status_current_check;

alter table public.wa_messages
  add constraint wa_messages_status_current_check
  check (status_current in ('preparing', 'accepted', 'sent', 'delivered', 'read', 'failed'));

create or replace function public.prepare_followup_attempt_v2(
  p_dispatch_id bigint,
  p_worker_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_dispatch public.followup_dispatches_v2%rowtype;
  v_sequence public.followup_sequences_v2%rowtype;
  v_lead public.lead%rowtype;
  v_credentials public.credentials%rowtype;
  v_validation jsonb;
  v_attempt_number integer;
  v_client_message_id text;
  v_wa_message_id uuid;
  v_attempt_id bigint;
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker_id is required';
  end if;

  select * into v_dispatch
  from public.followup_dispatches_v2 d
  where d.id = p_dispatch_id
  for update;

  if not found then
    return jsonb_build_object('prepared', false, 'reason', 'dispatch_not_found');
  end if;

  v_validation := public.revalidate_followup_dispatch_v2(p_dispatch_id, p_worker_id);
  if coalesce((v_validation ->> 'valid')::boolean, false) is not true then
    return jsonb_build_object(
      'prepared', false,
      'reason', v_validation ->> 'reason'
    );
  end if;

  select * into v_sequence
  from public.followup_sequences_v2 s
  where s.id = v_dispatch.sequence_id;

  select * into v_lead
  from public.lead l
  where l.id = v_dispatch.lead_id;

  select * into v_credentials
  from public.credentials c
  where c.id_empresa = v_dispatch.id_empresa
  order by c.id
  limit 1;

  if not found then
    update public.followup_dispatches_v2
       set status = 'cancelled',
           cancellation_reason = 'credentials_not_found',
           completed_at = now(),
           updated_at = now()
     where id = p_dispatch_id;

    return jsonb_build_object('prepared', false, 'reason', 'credentials_not_found');
  end if;

  select coalesce(max(a.attempt_number), 0) + 1
    into v_attempt_number
  from public.followup_attempts_v2 a
  where a.dispatch_id = p_dispatch_id;

  if v_attempt_number > v_sequence.max_attempts then
    update public.followup_dispatches_v2
       set status = 'failed',
           failed_at = now(),
           completed_at = now(),
           cancellation_reason = 'max_attempts_reached',
           updated_at = now()
     where id = p_dispatch_id;

    return jsonb_build_object('prepared', false, 'reason', 'max_attempts_reached');
  end if;

  v_client_message_id := concat(
    'followup_v2_',
    p_dispatch_id,
    '_',
    v_attempt_number,
    '_',
    replace(gen_random_uuid()::text, '-', '')
  );

  insert into public.wa_messages (
    phone_number_id,
    client_message_id,
    direction,
    to_wa_id,
    contact_name,
    type,
    text_body,
    template_name,
    template_language,
    template_variables,
    status_current,
    status_last_at,
    tenant_id,
    crm_provider,
    crm_entity_type,
    crm_entity_id,
    crm_sync_status,
    raw
  ) values (
    v_credentials.whatsapp_business_id,
    v_client_message_id,
    'outbound',
    v_lead.numero,
    v_lead.nome,
    'template',
    v_dispatch.rendered_crm_message,
    v_dispatch.context_snapshot ->> 'meta_template_name',
    v_dispatch.context_snapshot ->> 'meta_template_language',
    coalesce(v_dispatch.context_snapshot -> 'parameter_mapping', '[]'::jsonb),
    'preparing',
    now(),
    v_dispatch.id_empresa,
    v_credentials.default_crm,
    case when v_credentials.default_crm = 'rd' then 'deal' else 'lead' end,
    v_lead.id_crm,
    'pending',
    jsonb_build_object(
      'source', 'followup_v2',
      'dispatch_id', p_dispatch_id,
      'attempt_number', v_attempt_number
    )
  )
  returning id into v_wa_message_id;

  insert into public.followup_attempts_v2 (
    dispatch_id,
    attempt_number,
    wa_message_id,
    status,
    requested_at,
    confirmation_deadline_at
  ) values (
    p_dispatch_id,
    v_attempt_number,
    v_wa_message_id,
    'preparing',
    now(),
    now() + make_interval(mins => v_sequence.delivery_timeout_minutes)
  )
  returning id into v_attempt_id;

  update public.followup_dispatches_v2
     set status = 'sending',
         updated_at = now()
   where id = p_dispatch_id;

  return jsonb_build_object(
    'prepared', true,
    'dispatch_id', p_dispatch_id,
    'attempt_id', v_attempt_id,
    'attempt_number', v_attempt_number,
    'wa_message_id', v_wa_message_id,
    'client_message_id', v_client_message_id,
    'phone_number_id', v_credentials.whatsapp_business_id,
    'lead_id', v_lead.id,
    'lead_name', v_lead.nome,
    'lead_phone', v_lead.numero,
    'lead_id_crm', v_lead.id_crm,
    'id_empresa', v_dispatch.id_empresa,
    'template_name', v_dispatch.context_snapshot ->> 'meta_template_name',
    'template_language', v_dispatch.context_snapshot ->> 'meta_template_language',
    'parameter_mapping', coalesce(v_dispatch.context_snapshot -> 'parameter_mapping', '[]'::jsonb),
    'media_url', v_dispatch.context_snapshot ->> 'media_url',
    'crm_message', v_dispatch.rendered_crm_message,
    'id_situacao', v_dispatch.context_snapshot ->> 'id_situacao'
  );
end;
$$;

revoke execute on function public.prepare_followup_attempt_v2(bigint, text)
  from public, anon, authenticated;
grant execute on function public.prepare_followup_attempt_v2(bigint, text)
  to service_role;

create or replace function public.accept_followup_attempt_v2(
  p_attempt_id bigint,
  p_meta_message_id text,
  p_meta_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt public.followup_attempts_v2%rowtype;
  v_dispatch public.followup_dispatches_v2%rowtype;
  v_next_step integer;
begin
  if nullif(btrim(p_meta_message_id), '') is null then
    raise exception 'meta_message_id is required';
  end if;

  select * into v_attempt
  from public.followup_attempts_v2 a
  where a.id = p_attempt_id
  for update;

  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'attempt_not_found');
  end if;

  if v_attempt.status <> 'preparing' then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'attempt_not_preparing',
      'status', v_attempt.status
    );
  end if;

  select * into v_dispatch
  from public.followup_dispatches_v2 d
  where d.id = v_attempt.dispatch_id
  for update;

  update public.wa_messages
     set message_id = p_meta_message_id,
         status_current = 'accepted',
         status_last_at = now(),
         raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('meta_response', coalesce(p_meta_response, '{}'::jsonb)),
         updated_at = now()
   where id = v_attempt.wa_message_id;

  update public.followup_attempts_v2
     set meta_message_id = p_meta_message_id,
         status = 'accepted',
         accepted_at = now(),
         meta_response = coalesce(p_meta_response, '{}'::jsonb),
         updated_at = now()
   where id = p_attempt_id;

  update public.followup_dispatches_v2
     set status = 'accepted',
         sent_to_meta_at = now(),
         updated_at = now()
   where id = v_dispatch.id;

  select min(st.step_order)
    into v_next_step
  from public.followup_steps_v2 st
  where st.sequence_id = v_dispatch.sequence_id
    and st.is_active = true
    and st.step_order > (
      select current_step.step_order
      from public.followup_steps_v2 current_step
      where current_step.id = v_dispatch.step_id
    );

  if v_next_step is null then
    update public.followup_enrollments_v2
       set status = 'completed',
           completed_at = now(),
           last_evaluated_at = now(),
           updated_at = now()
     where id = v_dispatch.enrollment_id;
  else
    update public.followup_enrollments_v2
       set next_step_order = v_next_step,
           last_evaluated_at = now(),
           updated_at = now()
     where id = v_dispatch.enrollment_id;
  end if;

  update public.lead
     set etapa_conversa = coalesce(v_next_step, etapa_conversa + 1),
         ult_message = now()::text,
         updated_at = now()
   where id = v_dispatch.lead_id;

  return jsonb_build_object(
    'accepted', true,
    'attempt_id', p_attempt_id,
    'dispatch_id', v_dispatch.id,
    'meta_message_id', p_meta_message_id,
    'next_step_order', v_next_step,
    'enrollment_completed', v_next_step is null
  );
end;
$$;

revoke execute on function public.accept_followup_attempt_v2(bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.accept_followup_attempt_v2(bigint, text, jsonb)
  to service_role;

create or replace function public.fail_followup_attempt_v2(
  p_attempt_id bigint,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default false,
  p_meta_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt public.followup_attempts_v2%rowtype;
  v_dispatch public.followup_dispatches_v2%rowtype;
  v_sequence public.followup_sequences_v2%rowtype;
  v_will_retry boolean := false;
begin
  select * into v_attempt
  from public.followup_attempts_v2 a
  where a.id = p_attempt_id
  for update;

  if not found then
    return jsonb_build_object('failed', false, 'reason', 'attempt_not_found');
  end if;

  select * into v_dispatch
  from public.followup_dispatches_v2 d
  where d.id = v_attempt.dispatch_id
  for update;

  select * into v_sequence
  from public.followup_sequences_v2 s
  where s.id = v_dispatch.sequence_id;

  v_will_retry := coalesce(p_retryable, false)
    and not v_sequence.stop_on_failure
    and v_attempt.attempt_number < v_sequence.max_attempts
    and public.followup_engine_mode_v2(v_dispatch.id_empresa) = 'v2';

  update public.wa_messages
     set status_current = 'failed',
         status_last_at = now(),
         failed_at = now(),
         error_code = p_error_code,
         error_message = p_error_message,
         raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('meta_response', coalesce(p_meta_response, '{}'::jsonb)),
         updated_at = now()
   where id = v_attempt.wa_message_id;

  update public.followup_attempts_v2
     set status = 'failed',
         failed_at = now(),
         error_code = p_error_code,
         error_message = p_error_message,
         meta_response = coalesce(p_meta_response, '{}'::jsonb),
         updated_at = now()
   where id = p_attempt_id;

  if v_will_retry then
    update public.followup_dispatches_v2
       set status = 'queued',
           scheduled_at = now() + interval '5 minutes',
           claimed_at = null,
           claimed_by = null,
           failed_at = null,
           updated_at = now()
     where id = v_dispatch.id;
  else
    update public.followup_dispatches_v2
       set status = 'failed',
           failed_at = now(),
           completed_at = now(),
           updated_at = now()
     where id = v_dispatch.id;

    update public.followup_enrollments_v2
       set status = case when v_sequence.stop_on_failure then 'failed' else status end,
           last_evaluated_at = now(),
           updated_at = now()
     where id = v_dispatch.enrollment_id;
  end if;

  return jsonb_build_object(
    'failed', true,
    'attempt_id', p_attempt_id,
    'dispatch_id', v_dispatch.id,
    'will_retry', v_will_retry
  );
end;
$$;

revoke execute on function public.fail_followup_attempt_v2(bigint, text, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.fail_followup_attempt_v2(bigint, text, text, boolean, jsonb)
  to service_role;

create or replace function public.mark_followup_confirmation_timeouts_v2(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  with candidates as (
    select a.id
    from public.followup_attempts_v2 a
    where a.status in ('accepted', 'sent')
      and a.confirmation_deadline_at <= now()
    order by a.confirmation_deadline_at, a.id
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
    for update of a skip locked
  ),
  updated_attempts as (
    update public.followup_attempts_v2 a
       set status = 'confirmation_timeout',
           updated_at = now()
      from candidates c
     where a.id = c.id
    returning a.dispatch_id
  )
  update public.followup_dispatches_v2 d
     set status = 'confirmation_timeout',
         completed_at = now(),
         updated_at = now()
    from updated_attempts u
   where d.id = u.dispatch_id;

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'confirmation_timeouts', v_updated,
    'automatic_resends', 0,
    'processed_at', now()
  );
end;
$$;

revoke execute on function public.mark_followup_confirmation_timeouts_v2(integer)
  from public, anon, authenticated;
grant execute on function public.mark_followup_confirmation_timeouts_v2(integer)
  to service_role;
