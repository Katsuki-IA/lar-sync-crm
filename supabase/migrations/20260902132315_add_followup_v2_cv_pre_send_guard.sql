create or replace function public.followup_crm_pre_send_context_v2(
  p_dispatch_id bigint,
  p_worker_id text
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_dispatch public.followup_dispatches_v2%rowtype;
  v_lead public.lead%rowtype;
  v_credentials public.credentials%rowtype;
  v_default_crm text;
begin
  if nullif(btrim(p_worker_id), '') is null then
    return jsonb_build_object('valid', false, 'reason', 'worker_id_required');
  end if;

  select * into v_dispatch
  from public.followup_dispatches_v2 d
  where d.id = p_dispatch_id;

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'dispatch_not_found');
  end if;

  if v_dispatch.status <> 'claimed' then
    return jsonb_build_object('valid', false, 'reason', 'dispatch_not_claimed');
  end if;

  if v_dispatch.claimed_by is distinct from p_worker_id then
    return jsonb_build_object('valid', false, 'reason', 'worker_mismatch');
  end if;

  select * into v_lead
  from public.lead l
  where l.id = v_dispatch.lead_id
    and l.id_empresa = v_dispatch.id_empresa;

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'lead_not_found');
  end if;

  select * into v_credentials
  from public.credentials c
  where c.id_empresa = v_dispatch.id_empresa
  order by c.id
  limit 1;

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'credentials_not_found');
  end if;

  v_default_crm := lower(coalesce(nullif(btrim(v_credentials.default_crm), ''), ''));

  if v_default_crm = 'cv'
     and (
       nullif(btrim(v_credentials.cv_crm_url), '') is null
       or nullif(btrim(v_credentials.cv_crm_token), '') is null
       or nullif(btrim(v_credentials.cv_crm_email), '') is null
     ) then
    return jsonb_build_object(
      'valid', false,
      'reason', 'cv_credentials_incomplete',
      'dispatch_id', v_dispatch.id,
      'lead_id', v_lead.id,
      'id_empresa', v_dispatch.id_empresa,
      'requires_cv_check', true
    );
  end if;

  return jsonb_build_object(
    'valid', true,
    'dispatch_id', v_dispatch.id,
    'lead_id', v_lead.id,
    'id_empresa', v_dispatch.id_empresa,
    'default_crm', v_default_crm,
    'requires_cv_check', v_default_crm = 'cv',
    'lead_phone', v_lead.numero,
    'lead_id_crm', nullif(btrim(v_lead.id_crm), ''),
    'cv_crm_url', nullif(rtrim(v_credentials.cv_crm_url, '/'), ''),
    'cv_crm_token', nullif(btrim(v_credentials.cv_crm_token), ''),
    'cv_crm_email', nullif(btrim(v_credentials.cv_crm_email), '')
  );
end;
$function$;

create or replace function public.cancel_followup_dispatch_by_crm_guard_v2(
  p_dispatch_id bigint,
  p_worker_id text,
  p_reason text,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_dispatch public.followup_dispatches_v2%rowtype;
  v_reason text := lower(nullif(btrim(p_reason), ''));
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
begin
  if nullif(btrim(p_worker_id), '') is null then
    return jsonb_build_object('cancelled', false, 'reason', 'worker_id_required');
  end if;

  if v_reason is null or v_reason not in (
    'crm_context_invalid',
    'crm_id_missing',
    'crm_lookup_failed',
    'crm_assigned'
  ) then
    return jsonb_build_object('cancelled', false, 'reason', 'invalid_cancellation_reason');
  end if;

  select * into v_dispatch
  from public.followup_dispatches_v2 d
  where d.id = p_dispatch_id
  for update;

  if not found then
    return jsonb_build_object('cancelled', false, 'reason', 'dispatch_not_found');
  end if;

  if v_dispatch.status <> 'claimed' then
    return jsonb_build_object('cancelled', false, 'reason', 'dispatch_not_claimed');
  end if;

  if v_dispatch.claimed_by is distinct from p_worker_id then
    return jsonb_build_object('cancelled', false, 'reason', 'worker_mismatch');
  end if;

  update public.followup_dispatches_v2 d
  set status = 'cancelled',
      cancellation_reason = v_reason,
      completed_at = now(),
      context_snapshot = coalesce(d.context_snapshot, '{}'::jsonb)
        || jsonb_build_object(
          'crm_pre_send_guard',
          v_details || jsonb_build_object('reason', v_reason, 'checked_at', now())
        ),
      updated_at = now()
  where d.id = p_dispatch_id;

  update public.followup_enrollments_v2 e
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = v_reason,
      context_snapshot = coalesce(e.context_snapshot, '{}'::jsonb)
        || jsonb_build_object(
          'crm_pre_send_guard',
          v_details || jsonb_build_object('reason', v_reason, 'checked_at', now())
        ),
      updated_at = now()
  where e.id = v_dispatch.enrollment_id
    and e.status = 'active';

  return jsonb_build_object(
    'cancelled', true,
    'dispatch_id', p_dispatch_id,
    'enrollment_id', v_dispatch.enrollment_id,
    'lead_id', v_dispatch.lead_id,
    'reason', v_reason
  );
end;
$function$;

revoke execute on function public.followup_crm_pre_send_context_v2(bigint, text)
  from public, anon, authenticated;
grant execute on function public.followup_crm_pre_send_context_v2(bigint, text)
  to service_role;

revoke execute on function public.cancel_followup_dispatch_by_crm_guard_v2(bigint, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.cancel_followup_dispatch_by_crm_guard_v2(bigint, text, text, jsonb)
  to service_role;

comment on function public.followup_crm_pre_send_context_v2(bigint, text) is
  'Returns the fail-safe CRM context used by the V2 worker before preparing a Meta attempt.';

comment on function public.cancel_followup_dispatch_by_crm_guard_v2(bigint, text, text, jsonb) is
  'Cancels a claimed V2 dispatch and enrollment when the external CRM pre-send guard blocks it.';
