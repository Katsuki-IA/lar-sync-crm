-- Follow-ups V2: fair company rotation for enqueue and worker claims.

alter table public.followup_engine_settings_v2
  add column if not exists last_claimed_at timestamptz;

comment on column public.followup_engine_settings_v2.last_claimed_at is
  'Last time the live worker claimed at least one dispatch for this company. Used for fair rotation.';

create index if not exists followup_dispatches_v2_ready_company_idx
  on public.followup_dispatches_v2 (id_empresa, scheduled_at, id)
  where status = 'queued' and dry_run = false;

create or replace function public.fair_live_followup_candidates_v2(
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
  with company_settings as materialized (
    select
      s.id_empresa,
      greatest(1, least(coalesce(s.live_batch_size, 15), 100)) as company_limit
    from public.followup_engine_settings_v2 s
    where s.engine_mode = 'v2'
      and (p_id_empresa is null or s.id_empresa = p_id_empresa)
  ),
  per_company as materialized (
    select
      c.*,
      cs.company_limit,
      row_number() over (
        partition by c.id_empresa
        order by c.last_message_at, c.lead_id, c.sequence_id, c.step_id
      ) as company_position
    from company_settings cs
    cross join lateral public.live_followup_candidates_v2(
      cs.id_empresa,
      least(
        cs.company_limit,
        greatest(1, least(coalesce(p_limit, 50), 500))
      )
    ) c
  ),
  fair as materialized (
    select pc.*
    from per_company pc
    where pc.company_position <= pc.company_limit
    order by
      pc.company_position,
      pc.last_message_at,
      pc.id_empresa,
      pc.lead_id,
      pc.sequence_id,
      pc.step_id
    limit greatest(1, least(coalesce(p_limit, 50), 500))
  )
  select
    f.lead_id,
    f.id_empresa,
    f.lead_nome,
    f.lead_telefone,
    f.lead_id_crm,
    f.effective_project_id,
    f.audience_scope,
    f.conversation_context,
    f.sequence_id,
    f.sequence_name,
    f.step_id,
    f.step_order,
    f.variant_id,
    f.meta_template_name,
    f.meta_template_language,
    f.parameter_mapping,
    f.crm_message_template,
    f.media_url,
    f.id_situacao,
    f.last_message_at,
    f.eligible_at,
    f.eligibility_reason
  from fair f
  order by
    f.company_position,
    f.last_message_at,
    f.id_empresa,
    f.lead_id,
    f.sequence_id,
    f.step_id;
$$;

revoke execute on function public.fair_live_followup_candidates_v2(bigint, integer)
  from public, anon, authenticated;
grant execute on function public.fair_live_followup_candidates_v2(bigint, integer)
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
    from public.fair_live_followup_candidates_v2(p_id_empresa, p_limit)
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
    from public.fair_live_followup_candidates_v2(p_id_empresa, p_limit)
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
    'mode', 'live_queue_fair',
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

create or replace function public.claim_followup_dispatches_v2(
  p_worker_id text,
  p_limit integer default 15
)
returns setof public.followup_dispatches_v2
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claimed_at timestamptz := clock_timestamp();
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker_id is required';
  end if;

  -- Terminally invalid rows leave the ready queue. Rows that are only outside
  -- their send window remain queued for a later run.
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
  with company_settings as materialized (
    select
      s.id_empresa,
      greatest(1, least(coalesce(s.live_batch_size, 15), 100)) as company_limit,
      s.last_claimed_at
    from public.followup_engine_settings_v2 s
    where s.engine_mode = 'v2'
  ),
  ranked as materialized (
    select
      d.id,
      cs.id_empresa,
      d.scheduled_at,
      row_number() over (
        partition by cs.id_empresa
        order by d.scheduled_at, d.id
      ) as company_position,
      cs.company_limit,
      cs.last_claimed_at
    from company_settings cs
    cross join lateral (
      select d.id, d.scheduled_at
      from public.followup_dispatches_v2 d
      where d.id_empresa = cs.id_empresa
        and d.status = 'queued'
        and d.dry_run = false
        and d.scheduled_at <= now()
        and public.followup_dispatch_validation_v2(d.id) is null
      order by d.scheduled_at, d.id
      limit cs.company_limit
    ) d
  ),
  fair_order as materialized (
    select r.*
    from ranked r
    where r.company_position <= r.company_limit
    order by
      r.company_position,
      r.last_claimed_at nulls first,
      r.scheduled_at,
      r.id_empresa,
      r.id
    limit greatest(1, least(coalesce(p_limit, 15), 100))
  ),
  candidates as (
    select d.id
    from fair_order f
    join public.followup_dispatches_v2 d on d.id = f.id
    order by
      f.company_position,
      f.last_claimed_at nulls first,
      f.scheduled_at,
      f.id_empresa,
      f.id
    for update of d skip locked
  )
  update public.followup_dispatches_v2 d
     set status = 'claimed',
         claimed_at = v_claimed_at,
         claimed_by = p_worker_id,
         updated_at = now()
    from candidates c
   where d.id = c.id
  returning d.*;

  update public.followup_engine_settings_v2 s
     set last_claimed_at = v_claimed_at,
         updated_at = now()
   where s.id_empresa in (
     select distinct d.id_empresa
     from public.followup_dispatches_v2 d
     where d.claimed_by = p_worker_id
       and d.claimed_at = v_claimed_at
   );
end;
$$;

revoke execute on function public.claim_followup_dispatches_v2(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_followup_dispatches_v2(text, integer)
  to service_role;

comment on function public.fair_live_followup_candidates_v2(bigint, integer) is
  'Selects live candidates in company round-robin order and enforces each company live_batch_size.';

comment on function public.enqueue_followup_dispatches_v2(bigint, integer) is
  'Creates idempotent live queue rows using fair company rotation. It never calls Meta or another external service.';

comment on function public.claim_followup_dispatches_v2(text, integer) is
  'Atomically claims a fair cross-company batch with SKIP LOCKED and updates each served company last_claimed_at.';
