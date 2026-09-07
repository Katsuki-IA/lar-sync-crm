-- Preserve the V1 behavior where each A/B/C variant can have its own delay and CRM stage.

alter table public.followup_variants_v2
  add column if not exists delay_minutes integer check (delay_minutes is null or delay_minutes >= 0),
  add column if not exists id_situacao bigint;

create or replace function public.import_followup_v1_config_v2(p_id_empresa bigint)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sequences integer := 0;
  v_steps integer := 0;
  v_variants integer := 0;
begin
  insert into public.followup_sequences_v2 (
    id_empresa, id_empreendimento, nome, audience_scope, status, metadata
  )
  select distinct
    fs.id_empresa::bigint,
    fs.id_empreendimento,
    'V1 migrada - ' || coalesce(emp.nome, 'geral'),
    'project',
    'draft',
    jsonb_build_object('source', 'followup_steps', 'imported_at', now())
  from public.followup_steps fs
  left join public.empreendimento emp on emp.id = fs.id_empreendimento
  where fs.id_empresa = p_id_empresa
    and not exists (
      select 1
      from public.followup_sequences_v2 seq
      where seq.id_empresa = fs.id_empresa
        and seq.id_empreendimento is not distinct from fs.id_empreendimento
        and seq.nome = 'V1 migrada - ' || coalesce(emp.nome, 'geral')
        and seq.status <> 'archived'
    );
  get diagnostics v_sequences = row_count;

  insert into public.followup_steps_v2 (
    sequence_id, step_order, nome, delay_minutes, id_situacao, is_active
  )
  select
    seq.id,
    fs.etapa,
    fs.nome,
    coalesce(fs.minutes_delay, 0),
    fs.id_situacao,
    coalesce(fs.is_active, true)
  from public.followup_steps fs
  left join public.empreendimento emp on emp.id = fs.id_empreendimento
  join public.followup_sequences_v2 seq
    on seq.id_empresa = fs.id_empresa
   and seq.id_empreendimento is not distinct from fs.id_empreendimento
   and seq.nome = 'V1 migrada - ' || coalesce(emp.nome, 'geral')
   and seq.status <> 'archived'
  where fs.id_empresa = p_id_empresa
  on conflict (sequence_id, step_order) do nothing;
  get diagnostics v_steps = row_count;

  with source_variants as (
    select
      seq.id as sequence_id,
      fs.etapa,
      'no_reply'::text as conversation_context,
      fs.template_name::text as meta_template_name,
      coalesce(fs.minutes_delay, 0) as delay_minutes,
      fs.id_situacao,
      case
        when nullif(btrim(coalesce(fs.parameters, '')), '') is null then '[]'::jsonb
        else to_jsonb(string_to_array(fs.parameters, ','))
      end as parameter_mapping,
      fs.message_template as crm_message_template,
      fs.url_imagem as media_url,
      coalesce(fs.is_active, true) as is_active
    from public.followup_steps fs
    left join public.empreendimento emp on emp.id = fs.id_empreendimento
    join public.followup_sequences_v2 seq
      on seq.id_empresa = fs.id_empresa
     and seq.id_empreendimento is not distinct from fs.id_empreendimento
     and seq.nome = 'V1 migrada - ' || coalesce(emp.nome, 'geral')
     and seq.status <> 'archived'
    where fs.id_empresa = p_id_empresa
      and nullif(btrim(fs.template_name), '') is not null

    union all

    select
      seq.id,
      fs.etapa,
      'engaged',
      fs.template_name_b,
      coalesce(fs.minutes_delay_b, fs.minutes_delay, 0),
      coalesce(fs.id_situacao_b::bigint, fs.id_situacao),
      case
        when nullif(btrim(coalesce(fs.parameters_b, '')), '') is null then '[]'::jsonb
        else to_jsonb(string_to_array(fs.parameters_b, ','))
      end,
      fs.message_template_b,
      fs.url_imagem_b,
      coalesce(fs.is_active, true)
    from public.followup_steps fs
    left join public.empreendimento emp on emp.id = fs.id_empreendimento
    join public.followup_sequences_v2 seq
      on seq.id_empresa = fs.id_empresa
     and seq.id_empreendimento is not distinct from fs.id_empreendimento
     and seq.nome = 'V1 migrada - ' || coalesce(emp.nome, 'geral')
     and seq.status <> 'archived'
    where fs.id_empresa = p_id_empresa
      and nullif(btrim(coalesce(fs.template_name_b, '')), '') is not null

    union all

    select
      seq.id,
      fs.etapa,
      'scheduling',
      fs.template_name_c,
      coalesce(fs.minutes_delay_c, fs.minutes_delay, 0),
      coalesce(fs.id_situacao_c::bigint, fs.id_situacao),
      case
        when nullif(btrim(coalesce(fs.parameters_c, '')), '') is null then '[]'::jsonb
        else to_jsonb(string_to_array(fs.parameters_c, ','))
      end,
      fs.message_template_c,
      fs.url_imagem_c,
      coalesce(fs.is_active, true)
    from public.followup_steps fs
    left join public.empreendimento emp on emp.id = fs.id_empreendimento
    join public.followup_sequences_v2 seq
      on seq.id_empresa = fs.id_empresa
     and seq.id_empreendimento is not distinct from fs.id_empreendimento
     and seq.nome = 'V1 migrada - ' || coalesce(emp.nome, 'geral')
     and seq.status <> 'archived'
    where fs.id_empresa = p_id_empresa
      and nullif(btrim(coalesce(fs.template_name_c, '')), '') is not null
  )
  insert into public.followup_variants_v2 (
    step_id,
    conversation_context,
    meta_template_name,
    meta_template_language,
    delay_minutes,
    id_situacao,
    parameter_mapping,
    crm_message_template,
    media_url,
    is_active,
    metadata
  )
  select
    st.id,
    sv.conversation_context,
    sv.meta_template_name,
    'pt_BR',
    sv.delay_minutes,
    sv.id_situacao,
    sv.parameter_mapping,
    sv.crm_message_template,
    sv.media_url,
    sv.is_active,
    jsonb_build_object('source', 'followup_steps')
  from source_variants sv
  join public.followup_steps_v2 st
    on st.sequence_id = sv.sequence_id
   and st.step_order = sv.etapa
  on conflict (step_id, conversation_context, meta_template_language) do nothing;
  get diagnostics v_variants = row_count;

  return jsonb_build_object(
    'id_empresa', p_id_empresa,
    'sequences_inserted', v_sequences,
    'steps_inserted', v_steps,
    'variants_inserted', v_variants,
    'status', 'draft',
    'live_send_enabled', false
  );
end;
$$;

revoke execute on function public.import_followup_v1_config_v2(bigint) from public, anon, authenticated;
grant execute on function public.import_followup_v1_config_v2(bigint) to service_role;

-- The original preview function is replaced so variant-specific timing and stage win over step defaults.
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
        select 1 from public.agendamento a
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
  order by c.last_message_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

revoke execute on function public.preview_followup_candidates_v2(bigint, integer) from public, anon, authenticated;
grant execute on function public.preview_followup_candidates_v2(bigint, integer) to service_role;
