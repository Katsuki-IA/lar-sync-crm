-- Follow-ups V2: safe activation cutoff with an explicit historical recovery option.

alter table public.followup_sequences_v2
  add column if not exists eligibility_mode text not null default 'after_activation',
  add column if not exists eligibility_since timestamptz,
  add column if not exists activated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'followup_sequences_v2_eligibility_mode_check'
      and conrelid = 'public.followup_sequences_v2'::regclass
  ) then
    alter table public.followup_sequences_v2
      add constraint followup_sequences_v2_eligibility_mode_check
      check (eligibility_mode in ('after_activation', 'since_date'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'followup_sequences_v2_eligibility_since_check'
      and conrelid = 'public.followup_sequences_v2'::regclass
  ) then
    alter table public.followup_sequences_v2
      add constraint followup_sequences_v2_eligibility_since_check
      check (eligibility_mode <> 'since_date' or eligibility_since is not null);
  end if;
end
$$;

create or replace function public.followup_sequence_v2_set_activation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.eligibility_mode = 'after_activation' then
    new.eligibility_since := null;
  end if;

  if new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and new.activated_at is null then
    new.activated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists followup_sequences_v2_set_activation_trg
  on public.followup_sequences_v2;

create trigger followup_sequences_v2_set_activation_trg
before insert or update on public.followup_sequences_v2
for each row execute function public.followup_sequence_v2_set_activation();

revoke execute on function public.followup_sequence_v2_set_activation()
  from public, anon, authenticated;

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
        where a.id_lead = l.id and a.deleted_at is null
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
     and seq.status in ('draft', 'shadow', 'active')
     and lb.last_message_at >= case
       when seq.eligibility_mode = 'since_date' then seq.eligibility_since
       else coalesce(seq.activated_at, seq.created_at)
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
      where d.idempotency_key = md5(concat_ws(
        ':', 'shadow', c.id, c.step_id, c.variant_id, c.last_message_at
      ))
    )
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

revoke execute on function public.preview_followup_candidates_v2(bigint, integer)
  from public, anon, authenticated;
revoke execute on function public.simulate_followup_dispatches_v2(bigint, integer)
  from public, anon, authenticated;
grant execute on function public.preview_followup_candidates_v2(bigint, integer)
  to service_role;
grant execute on function public.simulate_followup_dispatches_v2(bigint, integer)
  to service_role;

comment on column public.followup_sequences_v2.eligibility_mode is
  'after_activation uses activated_at (or created_at while still in draft/shadow); since_date uses eligibility_since for controlled historical recovery.';
comment on column public.followup_sequences_v2.eligibility_since is
  'Minimum lead last-message timestamp when eligibility_mode is since_date.';
comment on column public.followup_sequences_v2.activated_at is
  'First transition timestamp to active. Set automatically and never reset by pause/resume.';
