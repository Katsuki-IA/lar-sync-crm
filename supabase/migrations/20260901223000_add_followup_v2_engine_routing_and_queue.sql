-- Follow-ups V2: company-level routing and inert live queue primitives.
-- Safe by default: companies without a row remain on legacy, no cron is created,
-- and no existing V2 sequence is activated by this migration.

create table public.followup_engine_settings_v2 (
  id_empresa bigint primary key references public.empresa_dados(id) on delete cascade,
  engine_mode text not null default 'legacy'
    check (engine_mode in ('legacy', 'shadow', 'v2', 'paused')),
  live_batch_size integer not null default 15
    check (live_batch_size between 1 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.followup_engine_settings_v2 is
  'Company-level routing gate. legacy=V1 sends, shadow=V1 sends and V2 simulates, v2=only V2 may send, paused=neither engine may send.';

alter table public.followup_engine_settings_v2 enable row level security;
revoke all on table public.followup_engine_settings_v2 from public, anon, authenticated;
grant select, insert, update, delete on table public.followup_engine_settings_v2 to service_role;

insert into public.followup_engine_settings_v2 (id_empresa, engine_mode)
select e.id, 'legacy'
from public.empresa_dados e
on conflict (id_empresa) do nothing;

create or replace function public.followup_engine_mode_v2(p_id_empresa bigint)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select s.engine_mode
      from public.followup_engine_settings_v2 s
      where s.id_empresa = p_id_empresa
    ),
    'legacy'
  );
$$;

revoke execute on function public.followup_engine_mode_v2(bigint)
  from public, anon, authenticated;
grant execute on function public.followup_engine_mode_v2(bigint) to service_role;

create or replace function public.followup_engine_settings_v2_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger followup_engine_settings_v2_touch_trg
before update on public.followup_engine_settings_v2
for each row execute function public.followup_engine_settings_v2_touch();

revoke execute on function public.followup_engine_settings_v2_touch()
  from public, anon, authenticated;

-- Patch the legacy selector in-place. This preserves its production behavior,
-- adding only the company gate at selection time and immediately before pg_net.
do $migration$
declare
  v_definition text;
  v_selection_marker text := 'WHERE l.atendimento_humano = false';
  v_dispatch_marker text := '      -- 8) Disparo';
begin
  select pg_get_functiondef('public.send_followup_leads()'::regprocedure)
    into v_definition;

  if position('public.followup_engine_mode_v2(l.id_empresa)' in v_definition) = 0 then
    if position(v_selection_marker in v_definition) = 0 then
      raise exception 'Could not locate the legacy follow-up selection marker';
    end if;

    v_definition := replace(
      v_definition,
      v_selection_marker,
      v_selection_marker || E'\n      AND public.followup_engine_mode_v2(l.id_empresa) IN (''legacy'', ''shadow'')'
    );
  end if;

  if position('legacy_engine_mode_changed' in v_definition) = 0 then
    if position(v_dispatch_marker in v_definition) = 0 then
      raise exception 'Could not locate the legacy follow-up dispatch marker';
    end if;

    v_definition := replace(
      v_definition,
      v_dispatch_marker,
      E'      -- Revalidate the company route immediately before the external call.\n'
      || E'      IF public.followup_engine_mode_v2(v_lead.id_empresa) NOT IN (''legacy'', ''shadow'') THEN\n'
      || E'        v_result := v_result || jsonb_build_object(\n'
      || E'          ''lead_id'', v_lead.id,\n'
      || E'          ''skipped'', ''legacy_engine_mode_changed''\n'
      || E'        );\n'
      || E'        CONTINUE;\n'
      || E'      END IF;\n\n'
      || v_dispatch_marker
    );
  end if;

  execute v_definition;
end
$migration$;

alter function public.send_followup_leads()
  set search_path = public, extensions, pg_temp;
revoke execute on function public.send_followup_leads()
  from public, anon, authenticated;
grant execute on function public.send_followup_leads() to service_role;

create or replace function public.followup_within_send_window_v2(
  p_timezone text,
  p_window_start time without time zone,
  p_window_end time without time zone,
  p_instant timestamptz default now()
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_local_time time without time zone;
begin
  if p_window_start is null and p_window_end is null then
    return true;
  end if;

  v_local_time := p_instant at time zone coalesce(nullif(p_timezone, ''), 'America/Sao_Paulo');

  if p_window_start is null then
    return v_local_time < p_window_end;
  end if;

  if p_window_end is null then
    return v_local_time >= p_window_start;
  end if;

  if p_window_start = p_window_end then
    return true;
  end if;

  if p_window_start < p_window_end then
    return v_local_time >= p_window_start and v_local_time < p_window_end;
  end if;

  return v_local_time >= p_window_start or v_local_time < p_window_end;
exception
  when invalid_parameter_value then
    return false;
end;
$$;

revoke execute on function public.followup_within_send_window_v2(text, time without time zone, time without time zone, timestamptz)
  from public, anon, authenticated;
grant execute on function public.followup_within_send_window_v2(text, time without time zone, time without time zone, timestamptz)
  to service_role;

create or replace function public.live_followup_candidates_v2(
  p_id_empresa bigint default null,
  p_limit integer default 50
)
returns table (
  lead_id bigint,
  id_empresa bigint,
  lead_nome text,
  lead_telefone text,
  lead_id_crm text,
  effective_project_id bigint,
  audience_scope text,
  conversation_context text,
  sequence_id bigint,
  sequence_name text,
  step_id bigint,
  step_order integer,
  variant_id bigint,
  meta_template_name text,
  meta_template_language text,
  parameter_mapping jsonb,
  crm_message_template text,
  media_url text,
  id_situacao bigint,
  last_message_at timestamptz,
  eligible_at timestamptz,
  eligibility_reason text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lead_base as (
    select
      l.*,
      coalesce(l.empreendimento_em_foco_id, l.id_empreendimento) as effective_project_id,
      public.followup_try_timestamptz_v2(l.ult_message) as last_message_at,
      public.followup_context_v2(l.status, l.qtd_interacoes) as resolved_context,
      case
        when coalesce(l.empreendimento_em_foco_id, l.id_empreendimento) is null
          then 'no_project'::text
        else 'project'::text
      end as resolved_scope
    from public.lead l
    where (p_id_empresa is null or l.id_empresa = p_id_empresa)
      and public.followup_engine_mode_v2(l.id_empresa) = 'v2'
      and coalesce(l.atendimento_humano, false) = false
      and l.status in ('ativo', 'agendando')
      and not exists (
        select 1
        from public.agendamento a
        where a.id_lead = l.id
          and a.deleted_at is null
      )
  ),
  configured as (
    select
      lb.*,
      seq.id as sequence_id,
      seq.nome as sequence_name,
      seq.audience_scope,
      st.id as step_id,
      st.step_order,
      coalesce(var.delay_minutes, st.delay_minutes) as effective_delay_minutes,
      coalesce(var.id_situacao, st.id_situacao) as effective_id_situacao,
      var.id as variant_id,
      var.meta_template_name,
      var.meta_template_language,
      var.parameter_mapping,
      var.crm_message_template,
      var.media_url,
      row_number() over (
        partition by lb.id
        order by
          case when seq.id_empreendimento = lb.effective_project_id then 0 else 1 end,
          seq.id
      ) as sequence_priority
    from lead_base lb
    join public.followup_sequences_v2 seq
      on seq.id_empresa = lb.id_empresa
     and seq.audience_scope = lb.resolved_scope
     and seq.status = 'active'
     and lb.last_message_at >= case
       when seq.eligibility_mode = 'since_date' then seq.eligibility_since
       else seq.activated_at
     end
     and (
       (seq.audience_scope = 'no_project' and seq.id_empreendimento is null)
       or
       (seq.audience_scope = 'project' and (
         seq.id_empreendimento = lb.effective_project_id
         or seq.id_empreendimento is null
       ))
     )
    left join public.followup_enrollments_v2 enr
      on enr.sequence_id = seq.id
     and enr.lead_id = lb.id
     and enr.status = 'active'
    join public.followup_steps_v2 st
      on st.sequence_id = seq.id
     and st.step_order = coalesce(enr.next_step_order, nullif(lb.etapa_conversa, 0)::integer, 1)
     and st.is_active = true
    join public.followup_variants_v2 var
      on var.step_id = st.id
     and var.conversation_context = lb.resolved_context
     and var.is_active = true
    where lb.last_message_at is not null
  )
  select
    c.id,
    c.id_empresa,
    c.nome::text,
    c.numero::text,
    c.id_crm,
    c.effective_project_id,
    c.audience_scope,
    c.resolved_context,
    c.sequence_id,
    c.sequence_name,
    c.step_id,
    c.step_order,
    c.variant_id,
    c.meta_template_name,
    c.meta_template_language,
    c.parameter_mapping,
    c.crm_message_template,
    c.media_url,
    c.effective_id_situacao,
    c.last_message_at,
    c.last_message_at + make_interval(mins => c.effective_delay_minutes),
    case
      when c.resolved_scope = 'no_project' then 'lead_without_project'
      when c.resolved_context = 'scheduling' then 'lead_scheduling_visit'
      when c.resolved_context = 'engaged' then 'lead_engaged_without_schedule'
      else 'lead_without_reply'
    end
  from configured c
  where c.sequence_priority = 1
    and now() >= c.last_message_at + make_interval(mins => c.effective_delay_minutes)
    and not exists (
      select 1
      from public.followup_dispatches_v2 d
      where d.sequence_id = c.sequence_id
        and d.lead_id = c.id
        and d.step_id = c.step_id
        and d.dry_run = false
    )
  order by c.last_message_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

revoke execute on function public.live_followup_candidates_v2(bigint, integer)
  from public, anon, authenticated;
grant execute on function public.live_followup_candidates_v2(bigint, integer)
  to service_role;

create or replace function public.enqueue_followup_dispatches_v2(
  p_id_empresa bigint default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_enrollments integer := 0;
  v_dispatches integer := 0;
begin
  with candidates as materialized (
    select *
    from public.live_followup_candidates_v2(p_id_empresa, p_limit)
  )
  insert into public.followup_enrollments_v2 (
    sequence_id,
    lead_id,
    next_step_order,
    status,
    last_evaluated_at,
    context_snapshot
  )
  select
    c.sequence_id,
    c.lead_id,
    c.step_order,
    'active',
    now(),
    jsonb_build_object(
      'source', 'live_v2',
      'initial_last_message_at', c.last_message_at,
      'initial_context', c.conversation_context
    )
  from candidates c
  on conflict (sequence_id, lead_id) do nothing;

  get diagnostics v_enrollments = row_count;

  with candidates as materialized (
    select *
    from public.live_followup_candidates_v2(p_id_empresa, p_limit)
  )
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
  )
  select
    enr.id,
    c.sequence_id,
    c.step_id,
    c.variant_id,
    c.lead_id,
    c.id_empresa,
    c.effective_project_id,
    c.conversation_context,
    'queued',
    false,
    c.eligible_at,
    md5(concat_ws(':', 'live', c.lead_id, c.step_id, c.variant_id, c.last_message_at)),
    jsonb_build_object(
      'audience_scope', c.audience_scope,
      'conversation_context', c.conversation_context,
      'eligibility_reason', c.eligibility_reason,
      'last_message_at', c.last_message_at,
      'lead_nome', c.lead_nome,
      'lead_telefone', c.lead_telefone,
      'lead_id_crm', c.lead_id_crm,
      'meta_template_name', c.meta_template_name,
      'meta_template_language', c.meta_template_language,
      'parameter_mapping', c.parameter_mapping,
      'media_url', c.media_url,
      'id_situacao', c.id_situacao
    ),
    c.crm_message_template
  from candidates c
  join public.followup_enrollments_v2 enr
    on enr.sequence_id = c.sequence_id
   and enr.lead_id = c.lead_id
   and enr.status = 'active'
   and enr.next_step_order = c.step_order
  on conflict (idempotency_key) do nothing;

  get diagnostics v_dispatches = row_count;

  return jsonb_build_object(
    'mode', 'live_queue',
    'enrollments_created', v_enrollments,
    'dispatches_queued', v_dispatches,
    'messages_sent', 0,
    'processed_at', now()
  );
end;
$$;

revoke execute on function public.enqueue_followup_dispatches_v2(bigint, integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_followup_dispatches_v2(bigint, integer)
  to service_role;

create or replace function public.followup_dispatch_validation_v2(p_dispatch_id bigint)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
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
      select 1 from public.agendamento a
      where a.id_lead = l.id and a.deleted_at is null
    ) then 'appointment_exists'
    when public.followup_try_timestamptz_v2(l.ult_message)
         is distinct from public.followup_try_timestamptz_v2(d.context_snapshot ->> 'last_message_at')
      then 'last_message_changed'
    when public.followup_context_v2(l.status, l.qtd_interacoes) <> d.conversation_context
      then 'conversation_context_changed'
    when coalesce(l.empreendimento_em_foco_id, l.id_empreendimento)
         is distinct from d.id_empreendimento
      then 'project_changed'
    when not public.followup_within_send_window_v2(
      seq.timezone,
      seq.send_window_start,
      seq.send_window_end,
      now()
    ) then 'outside_send_window'
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
$$;

revoke execute on function public.followup_dispatch_validation_v2(bigint)
  from public, anon, authenticated;
grant execute on function public.followup_dispatch_validation_v2(bigint)
  to service_role;

create or replace function public.claim_followup_dispatches_v2(
  p_worker_id text,
  p_limit integer default 15
)
returns setof public.followup_dispatches_v2
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker_id is required';
  end if;

  -- Terminally invalid rows are removed from the ready queue. A dispatch that
  -- is merely outside its configured window remains queued for a later run.
  with invalid as (
    select
      d.id,
      public.followup_dispatch_validation_v2(d.id) as reason
    from public.followup_dispatches_v2 d
    where d.status = 'queued'
      and d.dry_run = false
      and d.scheduled_at <= now()
    order by d.scheduled_at, d.id
    limit greatest(1, least(coalesce(p_limit, 15), 100)) * 5
    for update of d skip locked
  )
  update public.followup_dispatches_v2 d
     set status = 'cancelled',
         cancellation_reason = i.reason,
         completed_at = now(),
         updated_at = now()
    from invalid i
   where d.id = i.id
     and i.reason is not null
     and i.reason <> 'outside_send_window';

  return query
  with candidates as (
    select d.id
    from public.followup_dispatches_v2 d
    where d.status = 'queued'
      and d.dry_run = false
      and d.scheduled_at <= now()
      and public.followup_dispatch_validation_v2(d.id) is null
    order by d.scheduled_at, d.id
    limit greatest(1, least(coalesce(p_limit, 15), 100))
    for update of d skip locked
  )
  update public.followup_dispatches_v2 d
     set status = 'claimed',
         claimed_at = now(),
         claimed_by = p_worker_id,
         updated_at = now()
    from candidates c
   where d.id = c.id
  returning d.*;
end;
$$;

revoke execute on function public.claim_followup_dispatches_v2(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_followup_dispatches_v2(text, integer)
  to service_role;

create or replace function public.revalidate_followup_dispatch_v2(
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
  v_reason text;
begin
  select *
    into v_dispatch
  from public.followup_dispatches_v2 d
  where d.id = p_dispatch_id
  for update;

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'dispatch_not_found');
  end if;

  if v_dispatch.status not in ('claimed', 'sending') then
    return jsonb_build_object('valid', false, 'reason', 'dispatch_not_claimed');
  end if;

  if v_dispatch.claimed_by is distinct from p_worker_id then
    return jsonb_build_object('valid', false, 'reason', 'worker_mismatch');
  end if;

  v_reason := public.followup_dispatch_validation_v2(p_dispatch_id);

  if v_reason is not null then
    update public.followup_dispatches_v2
       set status = 'cancelled',
           cancellation_reason = v_reason,
           completed_at = now(),
           updated_at = now()
     where id = p_dispatch_id;

    return jsonb_build_object('valid', false, 'reason', v_reason);
  end if;

  return jsonb_build_object(
    'valid', true,
    'dispatch_id', p_dispatch_id,
    'worker_id', p_worker_id
  );
end;
$$;

revoke execute on function public.revalidate_followup_dispatch_v2(bigint, text)
  from public, anon, authenticated;
grant execute on function public.revalidate_followup_dispatch_v2(bigint, text)
  to service_role;

create index followup_dispatches_v2_claimed_worker_idx
  on public.followup_dispatches_v2 (claimed_by, claimed_at)
  where status in ('claimed', 'sending') and dry_run = false;
