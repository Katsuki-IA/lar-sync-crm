create or replace function public.crm_ensure_operational_lead_for_whatsapp_reentry(
  p_crm_lead_id bigint,
  p_phone text default null,
  p_observed_at timestamptz default pg_catalog.now()
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crm public.crm_leads%rowtype;
  v_phone text;
  v_lead_id bigint;
  v_legacy_key text;
  v_latest_message text;
  v_observed_at timestamptz := coalesce(p_observed_at, pg_catalog.now());
begin
  select cl.*
    into v_crm
  from public.crm_leads cl
  where cl.id = p_crm_lead_id;

  if not found then
    return null;
  end if;

  v_phone := nullif(
    pg_catalog.regexp_replace(
      coalesce(nullif(p_phone, ''), v_crm.telefone, ''),
      '[^0-9]',
      '',
      'g'
    ),
    ''
  );

  if v_phone is null and v_crm.wa_identity_id is null then
    return null;
  end if;

  v_legacy_key := coalesce(
    nullif(v_crm.legacy_conversation_key, ''),
    case
      when v_phone is not null then v_phone || v_crm.id_empresa::text
      else null
    end
  );

  -- Serialize concurrent reentries for the same tenant/contact.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'crm-whatsapp-reentry:' || v_crm.id_empresa::text || ':' ||
      coalesce(v_crm.wa_identity_id::text, v_phone, v_crm.id::text),
      0
    )
  );

  select l.id
    into v_lead_id
  from public.lead l
  where l.id_empresa = v_crm.id_empresa
    and (
      l.id_crm = v_crm.id::text
      or (v_crm.lead_id is not null and l.id = v_crm.lead_id)
      or (
        v_crm.wa_identity_id is not null
        and l.wa_identity_id = v_crm.wa_identity_id
      )
      or (
        v_phone is not null
        and pg_catalog.regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g') = v_phone
        and (l.id_crm is null or l.id_crm = v_crm.id::text)
      )
    )
  order by
    case
      when l.id_crm = v_crm.id::text then 0
      when v_crm.lead_id is not null and l.id = v_crm.lead_id then 1
      when v_crm.wa_identity_id is not null and l.wa_identity_id = v_crm.wa_identity_id then 2
      else 3
    end,
    coalesce(l.updated_at, l.created_at) desc nulls last,
    l.id desc
  limit 1
  for update;

  if v_legacy_key is not null then
    select nullif(c.message #>> '{}', '')
      into v_latest_message
    from public.n8n_chat_conversas c
    where c.type in ('human', 'ai')
      and (
        nullif(c.legacy_conversation_key, '') = v_legacy_key
        or pg_catalog.regexp_replace(coalesce(c.numero, ''), '[^0-9]', '', 'g') = v_legacy_key
        or (
          c.id_empresa = v_crm.id_empresa
          and v_phone is not null
          and pg_catalog.regexp_replace(coalesce(c.telefone, ''), '[^0-9]', '', 'g') = v_phone
        )
      )
    order by coalesce(c.time, c.created_at) desc, c.id desc
    limit 1;
  end if;

  if v_lead_id is null then
    insert into public.lead (
      id_empresa,
      id_empreendimento,
      nome,
      numero,
      ult_message,
      atendimento_humano,
      id_crm,
      status,
      etapa_conversa,
      lead_quente,
      email,
      last_message_timestamp,
      last_mesage,
      empreendimento_em_foco_id,
      empreendimento_em_foco_nome,
      qualificado,
      crm_assigned_to,
      crm_stage_id,
      wa_user_id,
      wa_parent_user_id,
      wa_username,
      conversation_key,
      legacy_conversation_key,
      wa_identity_id,
      created_at,
      updated_at
    )
    values (
      v_crm.id_empresa,
      v_crm.id_empreendimento,
      v_crm.nome,
      v_phone,
      v_latest_message,
      false,
      v_crm.id::text,
      coalesce(v_crm.status, 'ativo'),
      1,
      coalesce(v_crm.lead_quente, false),
      v_crm.email,
      extract(epoch from v_observed_at)::bigint::text,
      'CTA',
      v_crm.id_empreendimento,
      (select e.nome::text from public.empreendimento e where e.id = v_crm.id_empreendimento),
      coalesce(v_crm.qualificado, 0),
      v_crm.crm_assigned_to,
      v_crm.crm_stage_id,
      v_crm.wa_user_id,
      v_crm.wa_parent_user_id,
      v_crm.wa_username,
      v_crm.conversation_key,
      v_legacy_key,
      v_crm.wa_identity_id,
      v_observed_at,
      v_observed_at
    )
    returning id into v_lead_id;
  else
    update public.lead l
    set
      id_crm = coalesce(l.id_crm, v_crm.id::text),
      numero = coalesce(nullif(l.numero, ''), v_phone),
      email = coalesce(l.email, v_crm.email),
      id_empreendimento = coalesce(l.id_empreendimento, v_crm.id_empreendimento),
      empreendimento_em_foco_id = coalesce(l.empreendimento_em_foco_id, v_crm.id_empreendimento),
      empreendimento_em_foco_nome = coalesce(
        l.empreendimento_em_foco_nome,
        (select e.nome::text from public.empreendimento e where e.id = v_crm.id_empreendimento)
      ),
      wa_user_id = coalesce(l.wa_user_id, v_crm.wa_user_id),
      wa_parent_user_id = coalesce(l.wa_parent_user_id, v_crm.wa_parent_user_id),
      wa_username = coalesce(l.wa_username, v_crm.wa_username),
      conversation_key = coalesce(l.conversation_key, v_crm.conversation_key),
      legacy_conversation_key = coalesce(l.legacy_conversation_key, v_legacy_key),
      wa_identity_id = coalesce(l.wa_identity_id, v_crm.wa_identity_id),
      ult_message = coalesce(v_latest_message, l.ult_message),
      last_message_timestamp = extract(epoch from v_observed_at)::bigint::text,
      updated_at = greatest(coalesce(l.updated_at, l.created_at, v_observed_at), v_observed_at)
    where l.id = v_lead_id;
  end if;

  update public.crm_leads cl
  set lead_id = v_lead_id
  where cl.id = v_crm.id
    and cl.lead_id is distinct from v_lead_id;

  return v_lead_id;
end;
$$;

comment on function public.crm_ensure_operational_lead_for_whatsapp_reentry(bigint, text, timestamptz)
is 'Idempotently restores the operational lead row used by the WhatsApp conversation hub.';

revoke all on function public.crm_ensure_operational_lead_for_whatsapp_reentry(bigint, text, timestamptz) from public, anon, authenticated;

create or replace function public.crm_restore_operational_lead_after_whatsapp_reentry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.metadata ->> 'event' = 'lead_reentered_whatsapp' then
    perform public.crm_ensure_operational_lead_for_whatsapp_reentry(
      new.lead_id,
      new.metadata ->> 'telefone',
      new.created_at
    );
  end if;

  return new;
end;
$$;

revoke all on function public.crm_restore_operational_lead_after_whatsapp_reentry() from public, anon, authenticated;

drop trigger if exists crm_restore_operational_lead_after_whatsapp_reentry
  on public.crm_lead_activities;

create trigger crm_restore_operational_lead_after_whatsapp_reentry
after insert on public.crm_lead_activities
for each row
when ((new.metadata ->> 'event') = 'lead_reentered_whatsapp')
execute function public.crm_restore_operational_lead_after_whatsapp_reentry();

-- Repair recent genuine WhatsApp reentries that were recorded before this trigger existed.
do $$
declare
  v_reentry record;
begin
  for v_reentry in
    select distinct on (a.lead_id)
      a.lead_id,
      a.metadata ->> 'telefone' as telefone,
      a.created_at
    from public.crm_lead_activities a
    join public.crm_leads cl on cl.id = a.lead_id
    where a.metadata ->> 'event' = 'lead_reentered_whatsapp'
      and a.created_at >= pg_catalog.now() - interval '14 days'
      and coalesce(cl.status, 'ativo') = 'ativo'
      and (
        exists (
          select 1
          from public.n8n_chat_conversas c
          where c.type in ('human', 'ai')
            and pg_catalog.regexp_replace(coalesce(c.numero, ''), '[^0-9]', '', 'g') =
              pg_catalog.regexp_replace(coalesce(a.metadata ->> 'telefone', cl.telefone, ''), '[^0-9]', '', 'g') || cl.id_empresa::text
        )
        or exists (
          select 1
          from public.wa_messages m
          where m.tenant_id = cl.id_empresa
            and m.crm_entity_id = cl.id::text
        )
      )
    order by a.lead_id, a.created_at desc
  loop
    perform public.crm_ensure_operational_lead_for_whatsapp_reentry(
      v_reentry.lead_id,
      v_reentry.telefone,
      v_reentry.created_at
    );
  end loop;
end;
$$;
