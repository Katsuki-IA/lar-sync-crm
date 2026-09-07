-- Follow-ups V2: single-lead, single-use pilot authorization.
-- This migration does not activate a sequence, change an engine mode, enqueue a
-- dispatch, call Meta, or write to an external CRM.

create table public.followup_test_authorizations_v2 (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  lead_id bigint not null references public.lead(id) on delete cascade,
  sequence_id bigint not null references public.followup_sequences_v2(id) on delete cascade,
  step_id bigint not null references public.followup_steps_v2(id) on delete cascade,
  variant_id bigint not null references public.followup_variants_v2(id) on delete cascade,
  expected_phone text not null check (btrim(expected_phone) <> ''),
  status text not null default 'authorized'
    check (status in ('authorized', 'queued', 'used', 'revoked', 'expired')),
  expires_at timestamptz not null,
  dispatch_id bigint references public.followup_dispatches_v2(id) on delete set null,
  used_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index followup_test_authorizations_v2_open_uidx
  on public.followup_test_authorizations_v2 (lead_id, sequence_id, step_id)
  where status in ('authorized', 'queued');

create index followup_test_authorizations_v2_expiry_idx
  on public.followup_test_authorizations_v2 (status, expires_at)
  where status = 'authorized';

create index followup_test_authorizations_v2_dispatch_fk_idx
  on public.followup_test_authorizations_v2 (dispatch_id)
  where dispatch_id is not null;

create trigger trg_followup_test_authorizations_v2_updated_at
before update on public.followup_test_authorizations_v2
for each row execute function public.set_updated_at();

alter table public.followup_test_authorizations_v2 enable row level security;
revoke all on table public.followup_test_authorizations_v2 from public, anon, authenticated;
grant select, insert, update, delete on table public.followup_test_authorizations_v2 to service_role;

create or replace function public.authorize_followup_test_v2(
  p_lead_id bigint,
  p_sequence_id bigint,
  p_step_id bigint,
  p_variant_id bigint,
  p_expected_phone text,
  p_expires_at timestamptz default (now() + interval '48 hours')
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_id_empresa bigint;
  v_phone text;
  v_context text;
begin
  if p_expires_at <= now() then
    raise exception 'expires_at must be in the future';
  end if;

  select l.id_empresa,
         regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g'),
         public.followup_context_v2(l.status, l.qtd_interacoes)
    into v_id_empresa, v_phone, v_context
  from public.lead l
  where l.id = p_lead_id;

  if not found then
    raise exception 'Lead not found: %', p_lead_id;
  end if;

  if v_phone <> regexp_replace(coalesce(p_expected_phone, ''), '[^0-9]', '', 'g') then
    raise exception 'Lead phone does not match the expected phone';
  end if;

  if not exists (
    select 1
    from public.followup_sequences_v2 seq
    join public.followup_steps_v2 st
      on st.sequence_id = seq.id and st.id = p_step_id and st.is_active
    join public.followup_variants_v2 v
      on v.step_id = st.id and v.id = p_variant_id and v.is_active
    where seq.id = p_sequence_id
      and seq.id_empresa = v_id_empresa
      and seq.audience_scope = 'no_project'
      and v.conversation_context = v_context
  ) then
    raise exception 'Sequence, step, variant, company, audience, or context does not match';
  end if;

  insert into public.followup_test_authorizations_v2 (
    id_empresa,
    lead_id,
    sequence_id,
    step_id,
    variant_id,
    expected_phone,
    expires_at,
    metadata
  ) values (
    v_id_empresa,
    p_lead_id,
    p_sequence_id,
    p_step_id,
    p_variant_id,
    v_phone,
    p_expires_at,
    jsonb_build_object('kind', 'single_lead_pilot', 'authorized_at', now())
  )
  returning id into v_id;

  return jsonb_build_object(
    'authorized', true,
    'authorization_id', v_id,
    'id_empresa', v_id_empresa,
    'lead_id', p_lead_id,
    'sequence_id', p_sequence_id,
    'step_id', p_step_id,
    'variant_id', p_variant_id,
    'expires_at', p_expires_at,
    'enqueued', false,
    'sent', false
  );
end;
$$;

revoke execute on function public.authorize_followup_test_v2(bigint, bigint, bigint, bigint, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.authorize_followup_test_v2(bigint, bigint, bigint, bigint, text, timestamptz)
  to service_role;

create or replace function public.preview_followup_test_v2(p_authorization_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_record record;
  v_blockers jsonb := '[]'::jsonb;
  v_readiness jsonb;
  v_context text;
  v_phone text;
  v_has_appointment boolean;
begin
  select a.*,
         l.nome as lead_name,
         l.numero as lead_phone,
         l.status as lead_status,
         l.qtd_interacoes,
         l.atendimento_humano,
         l.id_empreendimento,
         l.empreendimento_em_foco_id,
         l.ult_message,
         seq.nome as sequence_name,
         seq.status as sequence_status,
         seq.audience_scope,
         seq.timezone,
         seq.send_window_start,
         seq.send_window_end,
         st.nome as step_name,
         st.step_order,
         st.delay_minutes as step_delay_minutes,
         v.conversation_context,
         v.meta_template_name,
         v.meta_template_language,
         v.parameter_mapping,
         v.crm_message_template,
         v.media_url
    into v_record
  from public.followup_test_authorizations_v2 a
  join public.lead l on l.id = a.lead_id
  join public.followup_sequences_v2 seq on seq.id = a.sequence_id
  join public.followup_steps_v2 st on st.id = a.step_id
  join public.followup_variants_v2 v on v.id = a.variant_id
  where a.id = p_authorization_id;

  if not found then
    return jsonb_build_object('found', false, 'authorization_id', p_authorization_id);
  end if;

  v_phone := regexp_replace(coalesce(v_record.lead_phone, ''), '[^0-9]', '', 'g');
  v_context := public.followup_context_v2(v_record.lead_status, v_record.qtd_interacoes);
  v_readiness := public.followup_sequence_readiness_v2(v_record.sequence_id);

  select exists (
    select 1 from public.agendamento ap
    where ap.id_lead = v_record.lead_id and ap.deleted_at is null
  ) into v_has_appointment;

  if v_record.status <> 'authorized' then
    v_blockers := v_blockers || jsonb_build_array('authorization_' || v_record.status);
  end if;
  if v_record.expires_at <= now() then
    v_blockers := v_blockers || jsonb_build_array('authorization_expired');
  end if;
  if v_phone <> v_record.expected_phone then
    v_blockers := v_blockers || jsonb_build_array('phone_changed');
  end if;
  if v_record.id_empresa is distinct from (
    select l.id_empresa from public.lead l where l.id = v_record.lead_id
  ) then
    v_blockers := v_blockers || jsonb_build_array('company_changed');
  end if;
  if v_record.audience_scope <> 'no_project'
     or coalesce(v_record.empreendimento_em_foco_id, v_record.id_empreendimento) is not null then
    v_blockers := v_blockers || jsonb_build_array('project_scope_changed');
  end if;
  if v_context <> v_record.conversation_context then
    v_blockers := v_blockers || jsonb_build_array('conversation_context_changed');
  end if;
  if coalesce(v_record.atendimento_humano, false) then
    v_blockers := v_blockers || jsonb_build_array('human_service_active');
  end if;
  if v_record.lead_status not in ('ativo', 'agendando') then
    v_blockers := v_blockers || jsonb_build_array('lead_status_ineligible');
  end if;
  if v_has_appointment then
    v_blockers := v_blockers || jsonb_build_array('appointment_exists');
  end if;
  if coalesce((v_readiness ->> 'ready')::boolean, false) is not true then
    v_blockers := v_blockers || jsonb_build_array('sequence_not_ready');
  end if;
  if v_record.sequence_status <> 'active' then
    v_blockers := v_blockers || jsonb_build_array('sequence_not_active');
  end if;
  if public.followup_engine_mode_v2(v_record.id_empresa) <> 'v2' then
    v_blockers := v_blockers || jsonb_build_array('engine_not_v2');
  end if;
  if not public.followup_within_send_window_v2(
    v_record.timezone,
    v_record.send_window_start,
    v_record.send_window_end,
    now()
  ) then
    v_blockers := v_blockers || jsonb_build_array('outside_send_window');
  end if;

  return jsonb_build_object(
    'found', true,
    'authorization_id', v_record.id,
    'authorization_status', v_record.status,
    'expires_at', v_record.expires_at,
    'ready_to_enqueue', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'engine_mode', public.followup_engine_mode_v2(v_record.id_empresa),
    'sequence_readiness', v_readiness,
    'selection', jsonb_build_object(
      'id_empresa', v_record.id_empresa,
      'lead_id', v_record.lead_id,
      'lead_name', v_record.lead_name,
      'phone', v_phone,
      'sequence_id', v_record.sequence_id,
      'sequence_name', v_record.sequence_name,
      'step_id', v_record.step_id,
      'step_name', v_record.step_name,
      'step_order', v_record.step_order,
      'delay_minutes', v_record.step_delay_minutes,
      'variant_id', v_record.variant_id,
      'conversation_context', v_record.conversation_context,
      'meta_template_name', v_record.meta_template_name,
      'meta_template_language', v_record.meta_template_language,
      'parameter_mapping', v_record.parameter_mapping,
      'crm_message', v_record.crm_message_template,
      'media_url', v_record.media_url,
      'last_message_at', v_record.ult_message
    )
  );
end;
$$;

revoke execute on function public.preview_followup_test_v2(uuid)
  from public, anon, authenticated;
grant execute on function public.preview_followup_test_v2(uuid) to service_role;

create or replace function public.enqueue_authorized_followup_test_v2(p_authorization_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_authorization public.followup_test_authorizations_v2%rowtype;
  v_preview jsonb;
  v_lead public.lead%rowtype;
  v_step public.followup_steps_v2%rowtype;
  v_variant public.followup_variants_v2%rowtype;
  v_enrollment_id bigint;
  v_dispatch_id bigint;
begin
  select * into v_authorization
  from public.followup_test_authorizations_v2 a
  where a.id = p_authorization_id
  for update;

  if not found then
    return jsonb_build_object('enqueued', false, 'reason', 'authorization_not_found');
  end if;

  v_preview := public.preview_followup_test_v2(p_authorization_id);
  if coalesce((v_preview ->> 'ready_to_enqueue')::boolean, false) is not true then
    return jsonb_build_object(
      'enqueued', false,
      'reason', 'preflight_failed',
      'preview', v_preview
    );
  end if;

  select * into v_lead from public.lead where id = v_authorization.lead_id for update;
  select * into v_step from public.followup_steps_v2 where id = v_authorization.step_id;
  select * into v_variant from public.followup_variants_v2 where id = v_authorization.variant_id;

  insert into public.followup_enrollments_v2 (
    sequence_id,
    lead_id,
    next_step_order,
    status,
    enrolled_at,
    last_evaluated_at,
    context_snapshot
  ) values (
    v_authorization.sequence_id,
    v_authorization.lead_id,
    v_step.step_order,
    'active',
    now(),
    now(),
    jsonb_build_object(
      'test_authorization_id', p_authorization_id,
      'single_lead_pilot', true
    )
  )
  on conflict (sequence_id, lead_id) do update
    set next_step_order = excluded.next_step_order,
        status = 'active',
        completed_at = null,
        cancelled_at = null,
        cancellation_reason = null,
        last_evaluated_at = now(),
        context_snapshot = excluded.context_snapshot,
        updated_at = now()
  returning id into v_enrollment_id;

  insert into public.followup_dispatches_v2 (
    enrollment_id,
    sequence_id,
    step_id,
    variant_id,
    lead_id,
    id_empresa,
    id_empreendimento,
    conversation_context,
    status,
    dry_run,
    scheduled_at,
    idempotency_key,
    context_snapshot,
    rendered_crm_message
  ) values (
    v_enrollment_id,
    v_authorization.sequence_id,
    v_authorization.step_id,
    v_authorization.variant_id,
    v_authorization.lead_id,
    v_authorization.id_empresa,
    null,
    v_variant.conversation_context,
    'queued',
    false,
    now(),
    'single-lead-test:' || p_authorization_id::text,
    jsonb_build_object(
      'test_authorization_id', p_authorization_id,
      'single_lead_pilot', true,
      'last_message_at', public.followup_try_timestamptz_v2(v_lead.ult_message),
      'meta_template_name', v_variant.meta_template_name,
      'meta_template_language', v_variant.meta_template_language,
      'parameter_mapping', v_variant.parameter_mapping,
      'media_url', v_variant.media_url,
      'id_situacao', coalesce(v_variant.id_situacao, v_step.id_situacao)
    ),
    v_variant.crm_message_template
  )
  returning id into v_dispatch_id;

  update public.followup_test_authorizations_v2
     set status = 'queued',
         dispatch_id = v_dispatch_id,
         used_at = now(),
         updated_at = now()
   where id = p_authorization_id;

  return jsonb_build_object(
    'enqueued', true,
    'authorization_id', p_authorization_id,
    'dispatch_id', v_dispatch_id,
    'lead_id', v_authorization.lead_id,
    'scheduled_at', now(),
    'sent', false
  );
end;
$$;

revoke execute on function public.enqueue_authorized_followup_test_v2(uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_authorized_followup_test_v2(uuid) to service_role;
