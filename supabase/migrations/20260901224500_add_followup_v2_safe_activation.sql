-- Follow-ups V2: readiness checks and explicit activation RPCs.
-- These functions do not create a cron or call an external service.

create or replace function public.followup_sequence_readiness_v2(p_sequence_id bigint)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_sequence public.followup_sequences_v2%rowtype;
  v_errors jsonb := '[]'::jsonb;
  v_step_count integer := 0;
  v_incomplete_steps integer := 0;
  v_invalid_timezone boolean := false;
  v_has_credentials boolean := false;
begin
  select * into v_sequence
  from public.followup_sequences_v2 s
  where s.id = p_sequence_id;

  if not found then
    return jsonb_build_object(
      'ready', false,
      'sequence_id', p_sequence_id,
      'errors', jsonb_build_array('sequence_not_found')
    );
  end if;

  select count(*) into v_step_count
  from public.followup_steps_v2 st
  where st.sequence_id = p_sequence_id
    and st.is_active = true;

  if v_step_count = 0 then
    v_errors := v_errors || jsonb_build_array('no_active_steps');
  end if;

  select count(*) into v_incomplete_steps
  from public.followup_steps_v2 st
  where st.sequence_id = p_sequence_id
    and st.is_active = true
    and exists (
      select 1
      from (values ('no_reply'), ('engaged'), ('scheduling')) required(context)
      where not exists (
        select 1
        from public.followup_variants_v2 v
        where v.step_id = st.id
          and v.conversation_context = required.context
          and v.is_active = true
          and nullif(btrim(v.meta_template_name), '') is not null
          and nullif(btrim(v.meta_template_language), '') is not null
      )
    );

  if v_incomplete_steps > 0 then
    v_errors := v_errors || jsonb_build_array('steps_missing_context_variants');
  end if;

  if v_sequence.eligibility_mode = 'since_date'
     and v_sequence.eligibility_since is null then
    v_errors := v_errors || jsonb_build_array('eligibility_since_required');
  end if;

  begin
    perform now() at time zone v_sequence.timezone;
  exception
    when invalid_parameter_value then
      v_invalid_timezone := true;
  end;

  if v_invalid_timezone then
    v_errors := v_errors || jsonb_build_array('invalid_timezone');
  end if;

  if (v_sequence.send_window_start is null) <> (v_sequence.send_window_end is null) then
    v_errors := v_errors || jsonb_build_array('incomplete_send_window');
  end if;

  select exists (
    select 1
    from public.credentials c
    where c.id_empresa = v_sequence.id_empresa
      and nullif(btrim(c.whatsapp_access_token), '') is not null
      and nullif(btrim(c.whatsapp_business_id), '') is not null
  ) into v_has_credentials;

  if not v_has_credentials then
    v_errors := v_errors || jsonb_build_array('whatsapp_credentials_missing');
  end if;

  return jsonb_build_object(
    'ready', jsonb_array_length(v_errors) = 0,
    'sequence_id', v_sequence.id,
    'id_empresa', v_sequence.id_empresa,
    'status', v_sequence.status,
    'active_steps', v_step_count,
    'incomplete_steps', v_incomplete_steps,
    'errors', v_errors
  );
end;
$$;

revoke execute on function public.followup_sequence_readiness_v2(bigint)
  from public, anon, authenticated;
grant execute on function public.followup_sequence_readiness_v2(bigint)
  to service_role;

create or replace function public.activate_followup_sequence_v2(p_sequence_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_readiness jsonb;
begin
  v_readiness := public.followup_sequence_readiness_v2(p_sequence_id);

  if coalesce((v_readiness ->> 'ready')::boolean, false) is not true then
    return jsonb_build_object(
      'activated', false,
      'readiness', v_readiness
    );
  end if;

  update public.followup_sequences_v2
     set status = 'active',
         updated_at = now()
   where id = p_sequence_id
     and status in ('draft', 'shadow', 'paused', 'active');

  if not found then
    return jsonb_build_object(
      'activated', false,
      'readiness', v_readiness,
      'reason', 'sequence_cannot_be_activated'
    );
  end if;

  return jsonb_build_object(
    'activated', true,
    'sequence_id', p_sequence_id,
    'readiness', public.followup_sequence_readiness_v2(p_sequence_id),
    'live_send_enabled', false
  );
end;
$$;

revoke execute on function public.activate_followup_sequence_v2(bigint)
  from public, anon, authenticated;
grant execute on function public.activate_followup_sequence_v2(bigint)
  to service_role;

create or replace function public.set_followup_engine_mode_v2(
  p_id_empresa bigint,
  p_engine_mode text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mode text := lower(nullif(btrim(p_engine_mode), ''));
  v_sequence record;
  v_readiness jsonb;
  v_active_sequences integer := 0;
  v_cancelled integer := 0;
begin
  if v_mode is null or v_mode not in ('legacy', 'shadow', 'v2', 'paused') then
    raise exception 'Invalid follow-up engine mode: %', p_engine_mode;
  end if;

  if not exists (
    select 1 from public.empresa_dados e where e.id = p_id_empresa
  ) then
    raise exception 'Company not found: %', p_id_empresa;
  end if;

  if v_mode = 'v2' then
    for v_sequence in
      select s.id
      from public.followup_sequences_v2 s
      where s.id_empresa = p_id_empresa
        and s.status = 'active'
    loop
      v_active_sequences := v_active_sequences + 1;
      v_readiness := public.followup_sequence_readiness_v2(v_sequence.id);

      if coalesce((v_readiness ->> 'ready')::boolean, false) is not true then
        return jsonb_build_object(
          'changed', false,
          'id_empresa', p_id_empresa,
          'requested_mode', v_mode,
          'reason', 'active_sequence_not_ready',
          'readiness', v_readiness
        );
      end if;
    end loop;

    if v_active_sequences = 0 then
      return jsonb_build_object(
        'changed', false,
        'id_empresa', p_id_empresa,
        'requested_mode', v_mode,
        'reason', 'no_active_sequences'
      );
    end if;
  end if;

  insert into public.followup_engine_settings_v2 (
    id_empresa,
    engine_mode,
    updated_at
  ) values (
    p_id_empresa,
    v_mode,
    now()
  )
  on conflict (id_empresa) do update
    set engine_mode = excluded.engine_mode,
        updated_at = now();

  if v_mode <> 'v2' then
    update public.followup_dispatches_v2 d
       set status = 'cancelled',
           cancellation_reason = 'engine_mode_changed_to_' || v_mode,
           completed_at = now(),
           updated_at = now()
     where d.id_empresa = p_id_empresa
       and d.dry_run = false
       and d.status = 'queued';

    get diagnostics v_cancelled = row_count;
  end if;

  return jsonb_build_object(
    'changed', true,
    'id_empresa', p_id_empresa,
    'engine_mode', v_mode,
    'queued_dispatches_cancelled', v_cancelled,
    'live_send_enabled', v_mode = 'v2',
    'changed_at', now()
  );
end;
$$;

revoke execute on function public.set_followup_engine_mode_v2(bigint, text)
  from public, anon, authenticated;
grant execute on function public.set_followup_engine_mode_v2(bigint, text)
  to service_role;
