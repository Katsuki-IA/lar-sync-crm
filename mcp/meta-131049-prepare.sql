CREATE OR REPLACE FUNCTION public.prepare_followup_attempt_v2(p_dispatch_id bigint, p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  v_cooldown_until timestamptz;
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

  v_cooldown_until := public.wa_marketing_cooldown_until(v_dispatch.id_empresa,v_credentials.whatsapp_business_id,v_lead.numero);
  if v_cooldown_until is not null then
    update public.followup_dispatches_v2 set status='queued',
      scheduled_at=greatest(scheduled_at,v_cooldown_until),claimed_at=null,claimed_by=null,updated_at=now()
    where id=p_dispatch_id;
    return jsonb_build_object('prepared',false,'reason','meta_marketing_cooldown_131049','blocked_until',v_cooldown_until);
  end if;

  select coalesce(max(a.attempt_number), 0) + 1
    into v_attempt_number
  from public.followup_attempts_v2 a
  where a.dispatch_id = p_dispatch_id;

  if (select count(*) from public.followup_attempts_v2 a where a.dispatch_id=p_dispatch_id and a.error_code is distinct from 'marketing_cooldown') >= v_sequence.max_attempts then
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
$function$

