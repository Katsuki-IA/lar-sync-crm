-- Follow-up V2 foundation.
-- This migration is intentionally inert: no cron, webhook, trigger, or live send is enabled.

create table public.followup_sequences_v2 (
  id bigint generated always as identity primary key,
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  id_empreendimento bigint references public.empreendimento(id) on delete cascade,
  nome text not null,
  audience_scope text not null default 'project'
    check (audience_scope in ('project', 'no_project')),
  status text not null default 'draft'
    check (status in ('draft', 'shadow', 'active', 'paused', 'archived')),
  timezone text not null default 'America/Sao_Paulo',
  send_window_start time without time zone,
  send_window_end time without time zone,
  max_attempts smallint not null default 1 check (max_attempts between 1 and 10),
  delivery_timeout_minutes integer not null default 1440 check (delivery_timeout_minutes > 0),
  stop_on_failure boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (audience_scope = 'no_project' and id_empreendimento is null)
    or audience_scope = 'project'
  )
);

create unique index followup_sequences_v2_project_uidx
  on public.followup_sequences_v2 (id_empresa, id_empreendimento, nome)
  where audience_scope = 'project' and id_empreendimento is not null and status <> 'archived';

create unique index followup_sequences_v2_company_project_uidx
  on public.followup_sequences_v2 (id_empresa, nome)
  where audience_scope = 'project' and id_empreendimento is null and status <> 'archived';

create unique index followup_sequences_v2_no_project_uidx
  on public.followup_sequences_v2 (id_empresa, nome)
  where audience_scope = 'no_project' and status <> 'archived';

create index followup_sequences_v2_company_status_idx
  on public.followup_sequences_v2 (id_empresa, status);

create table public.followup_steps_v2 (
  id bigint generated always as identity primary key,
  sequence_id bigint not null references public.followup_sequences_v2(id) on delete cascade,
  step_order integer not null check (step_order > 0),
  nome text,
  delay_minutes integer not null check (delay_minutes >= 0),
  id_situacao bigint,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, step_order)
);

create index followup_steps_v2_sequence_active_idx
  on public.followup_steps_v2 (sequence_id, step_order)
  where is_active;

create table public.followup_variants_v2 (
  id bigint generated always as identity primary key,
  step_id bigint not null references public.followup_steps_v2(id) on delete cascade,
  conversation_context text not null
    check (conversation_context in ('no_reply', 'engaged', 'scheduling')),
  meta_template_name text not null check (btrim(meta_template_name) <> ''),
  meta_template_language text not null default 'pt_BR' check (btrim(meta_template_language) <> ''),
  parameter_mapping jsonb not null default '[]'::jsonb
    check (jsonb_typeof(parameter_mapping) = 'array'),
  crm_message_template text,
  media_url text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (step_id, conversation_context, meta_template_language)
);

create index followup_variants_v2_step_context_idx
  on public.followup_variants_v2 (step_id, conversation_context)
  where is_active;

create table public.followup_enrollments_v2 (
  id bigint generated always as identity primary key,
  sequence_id bigint not null references public.followup_sequences_v2(id) on delete cascade,
  lead_id bigint not null references public.lead(id) on delete cascade,
  next_step_order integer not null default 1 check (next_step_order > 0),
  status text not null default 'shadow'
    check (status in ('shadow', 'active', 'paused', 'completed', 'cancelled', 'failed')),
  enrolled_at timestamptz not null default now(),
  last_evaluated_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  context_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, lead_id)
);

create index followup_enrollments_v2_lead_idx
  on public.followup_enrollments_v2 (lead_id);

create index followup_enrollments_v2_ready_idx
  on public.followup_enrollments_v2 (sequence_id, next_step_order, last_evaluated_at)
  where status in ('shadow', 'active');

create table public.followup_dispatches_v2 (
  id bigint generated always as identity primary key,
  enrollment_id bigint references public.followup_enrollments_v2(id) on delete set null,
  sequence_id bigint not null references public.followup_sequences_v2(id) on delete restrict,
  step_id bigint not null references public.followup_steps_v2(id) on delete restrict,
  variant_id bigint not null references public.followup_variants_v2(id) on delete restrict,
  lead_id bigint not null references public.lead(id) on delete cascade,
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  id_empreendimento bigint references public.empreendimento(id) on delete set null,
  conversation_context text not null
    check (conversation_context in ('no_reply', 'engaged', 'scheduling')),
  status text not null default 'simulated'
    check (status in (
      'simulated', 'queued', 'claimed', 'sending', 'accepted', 'sent',
      'delivered', 'read', 'failed', 'cancelled', 'confirmation_timeout'
    )),
  dry_run boolean not null default true,
  scheduled_at timestamptz not null,
  claimed_at timestamptz,
  claimed_by text,
  sent_to_meta_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  completed_at timestamptz,
  cancellation_reason text,
  idempotency_key text not null,
  context_snapshot jsonb not null default '{}'::jsonb,
  rendered_crm_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key)
);

create index followup_dispatches_v2_ready_idx
  on public.followup_dispatches_v2 (scheduled_at, id)
  where status = 'queued' and dry_run = false;

create index followup_dispatches_v2_lead_idx
  on public.followup_dispatches_v2 (lead_id, created_at desc);

create index followup_dispatches_v2_company_status_idx
  on public.followup_dispatches_v2 (id_empresa, status, created_at desc);

create table public.followup_attempts_v2 (
  id bigint generated always as identity primary key,
  dispatch_id bigint not null references public.followup_dispatches_v2(id) on delete cascade,
  attempt_number smallint not null check (attempt_number > 0),
  wa_message_id uuid references public.wa_messages(id) on delete set null,
  meta_message_id text,
  status text not null default 'preparing'
    check (status in (
      'preparing', 'accepted', 'sent', 'delivered', 'read', 'failed',
      'cancelled', 'confirmation_timeout'
    )),
  requested_at timestamptz,
  accepted_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  confirmation_deadline_at timestamptz,
  error_code text,
  error_message text,
  meta_response jsonb not null default '{}'::jsonb,
  crm_delivery_notified_at timestamptz,
  crm_failure_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dispatch_id, attempt_number)
);

create unique index followup_attempts_v2_wa_message_uidx
  on public.followup_attempts_v2 (wa_message_id)
  where wa_message_id is not null;

create unique index followup_attempts_v2_meta_message_uidx
  on public.followup_attempts_v2 (meta_message_id)
  where meta_message_id is not null;

create index followup_attempts_v2_pending_status_idx
  on public.followup_attempts_v2 (status, confirmation_deadline_at)
  where status in ('preparing', 'accepted', 'sent');

alter table public.followup_sequences_v2 enable row level security;
alter table public.followup_steps_v2 enable row level security;
alter table public.followup_variants_v2 enable row level security;
alter table public.followup_enrollments_v2 enable row level security;
alter table public.followup_dispatches_v2 enable row level security;
alter table public.followup_attempts_v2 enable row level security;

revoke all on table public.followup_sequences_v2 from anon, authenticated;
revoke all on table public.followup_steps_v2 from anon, authenticated;
revoke all on table public.followup_variants_v2 from anon, authenticated;
revoke all on table public.followup_enrollments_v2 from anon, authenticated;
revoke all on table public.followup_dispatches_v2 from anon, authenticated;
revoke all on table public.followup_attempts_v2 from anon, authenticated;

grant select, insert, update, delete on table public.followup_sequences_v2 to service_role;
grant select, insert, update, delete on table public.followup_steps_v2 to service_role;
grant select, insert, update, delete on table public.followup_variants_v2 to service_role;
grant select, insert, update, delete on table public.followup_enrollments_v2 to service_role;
grant select, insert, update, delete on table public.followup_dispatches_v2 to service_role;
grant select, insert, update, delete on table public.followup_attempts_v2 to service_role;

grant usage, select on all sequences in schema public to service_role;

create or replace function public.followup_context_v2(
  p_status text,
  p_qtd_interacoes integer
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(coalesce(p_status, '')) = 'agendando' then 'scheduling'
    when coalesce(p_qtd_interacoes, 0) >= 2 then 'engaged'
    else 'no_reply'
  end;
$$;

create or replace function public.followup_try_timestamptz_v2(p_value text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public.preview_followup_candidates_v2(
  p_id_empresa bigint default null,
  p_limit integer default 50
)
returns table (
  lead_id bigint,
  id_empresa bigint,
  lead_nome text,
  lead_telefone text,
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
      st.delay_minutes,
      st.id_situacao,
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
     and seq.status in ('draft', 'shadow', 'active')
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
     and enr.status in ('shadow', 'active')
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
    c.id_situacao,
    c.last_message_at,
    c.last_message_at + make_interval(mins => c.delay_minutes),
    case
      when c.resolved_scope = 'no_project' then 'lead_without_project'
      when c.resolved_context = 'scheduling' then 'lead_scheduling_visit'
      when c.resolved_context = 'engaged' then 'lead_engaged_without_schedule'
      else 'lead_without_reply'
    end
  from configured c
  where c.sequence_priority = 1
    and now() >= c.last_message_at + make_interval(mins => c.delay_minutes)
  order by c.last_message_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

create or replace function public.simulate_followup_dispatches_v2(
  p_id_empresa bigint default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  insert into public.followup_dispatches_v2 (
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
    c.sequence_id,
    c.step_id,
    c.variant_id,
    c.lead_id,
    c.id_empresa,
    c.effective_project_id,
    c.conversation_context,
    'simulated',
    true,
    c.eligible_at,
    md5(concat_ws(':', 'shadow', c.lead_id, c.step_id, c.variant_id, c.last_message_at)),
    jsonb_build_object(
      'audience_scope', c.audience_scope,
      'conversation_context', c.conversation_context,
      'eligibility_reason', c.eligibility_reason,
      'last_message_at', c.last_message_at,
      'meta_template_name', c.meta_template_name,
      'meta_template_language', c.meta_template_language,
      'parameter_mapping', c.parameter_mapping
    ),
    c.crm_message_template
  from public.preview_followup_candidates_v2(p_id_empresa, p_limit) c
  on conflict (idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'mode', 'simulation',
    'inserted', v_inserted,
    'live_send_enabled', false,
    'processed_at', now()
  );
end;
$$;

create or replace function public.reconcile_followup_attempts_v2(p_limit integer default 100)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  with candidates as (
    select
      a.id,
      case
        when m.read_at is not null then 'read'
        when m.delivered_at is not null then 'delivered'
        when m.failed_at is not null then 'failed'
        when m.sent_at is not null then 'sent'
        else coalesce(m.status_current, a.status)
      end as resolved_status,
      m.sent_at,
      m.delivered_at,
      m.read_at,
      m.failed_at,
      m.error_code,
      m.error_message
    from public.followup_attempts_v2 a
    join public.wa_messages m on m.id = a.wa_message_id
    where a.status not in ('read', 'failed', 'cancelled', 'confirmation_timeout')
    order by a.id
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
    for update of a skip locked
  ),
  updated_attempts as (
    update public.followup_attempts_v2 a
       set status = c.resolved_status,
           sent_at = coalesce(c.sent_at, a.sent_at),
           delivered_at = coalesce(c.delivered_at, a.delivered_at),
           read_at = coalesce(c.read_at, a.read_at),
           failed_at = coalesce(c.failed_at, a.failed_at),
           error_code = coalesce(c.error_code, a.error_code),
           error_message = coalesce(c.error_message, a.error_message),
           updated_at = now()
      from candidates c
     where a.id = c.id
       and a.status is distinct from c.resolved_status
    returning a.dispatch_id, a.status, a.delivered_at, a.read_at, a.failed_at
  )
  update public.followup_dispatches_v2 d
     set status = u.status,
         delivered_at = coalesce(u.read_at, u.delivered_at, d.delivered_at),
         failed_at = coalesce(u.failed_at, d.failed_at),
         completed_at = case when u.status in ('delivered', 'read', 'failed') then now() else d.completed_at end,
         updated_at = now()
    from updated_attempts u
   where d.id = u.dispatch_id;

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'dispatches_updated', v_updated,
    'processed_at', now()
  );
end;
$$;

revoke execute on function public.followup_context_v2(text, integer) from public, anon, authenticated;
revoke execute on function public.followup_try_timestamptz_v2(text) from public, anon, authenticated;
revoke execute on function public.preview_followup_candidates_v2(bigint, integer) from public, anon, authenticated;
revoke execute on function public.simulate_followup_dispatches_v2(bigint, integer) from public, anon, authenticated;
revoke execute on function public.reconcile_followup_attempts_v2(integer) from public, anon, authenticated;

grant execute on function public.followup_context_v2(text, integer) to service_role;
grant execute on function public.followup_try_timestamptz_v2(text) to service_role;
grant execute on function public.preview_followup_candidates_v2(bigint, integer) to service_role;
grant execute on function public.simulate_followup_dispatches_v2(bigint, integer) to service_role;
grant execute on function public.reconcile_followup_attempts_v2(integer) to service_role;

comment on table public.followup_sequences_v2 is
  'Follow-up V2 configuration. No sequence is live unless status is explicitly changed to active.';
comment on table public.followup_dispatches_v2 is
  'Logical V2 dispatches. Phase 1 writes simulations only and never sends messages.';
comment on table public.followup_attempts_v2 is
  'One row per technical Meta send attempt, linked to the generic wa_messages transport ledger.';
