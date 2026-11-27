create or replace function private.reset_whatsapp_lead(p_empresa bigint, p_phone text, p_user text)
returns table (
  leads_encontrados bigint,
  identidades_encontradas bigint,
  chaves_encontradas bigint,
  chaves_sessao jsonb,
  qualificacoes_externas_excluidas bigint,
  conclusoes_followup_excluidas bigint,
  eventos_followup_excluidos bigint,
  memorias_excluidas bigint,
  mensagens_whatsapp_excluidas bigint,
  identidades_excluidas bigint,
  alertas_whatsapp_excluidos bigint,
  envios_cv_excluidos bigint,
  ativacoes_cv_excluidas bigint,
  leads_crm_excluidos bigint,
  leads_excluidos bigint
)
language plpgsql volatile security invoker
set search_path = ''
as $reset$
declare
  v_leads bigint[];
  v_crm bigint[];
  v_identities uuid[];
  v_keys text[];
  v_phones text[];
  v_messages uuid[];
begin
  with
  params as materialized (
    select
      p_empresa::bigint as id_empresa,
      nullif(regexp_replace(coalesce(p_phone::text, ''), '[^0-9]', '', 'g'), '') as telefone,
      nullif(btrim(p_user::text), '') as wa_user_id
  ),
  resolved as materialized (
    select r.*
    from params p
    cross join lateral public.wa_resolve_conversation_identity(
      p.id_empresa, p.wa_user_id, p.telefone
    ) r
  ),
  seed_identities as materialized (
    select r.wa_identity_id as id
    from resolved r
    where r.wa_identity_id is not null
  ),
  prospect_phones as materialized (
    select v.phone
    from params p
    cross join lateral (select public.crm_phone_match_key(p.telefone) as digits) k
    cross join lateral (values (k.digits), (case when length(k.digits) in (10,11) then '55' || k.digits else substr(k.digits,3) end)) v(phone)
    where p.id_empresa = 41 and k.digits ~ '^(55)?[1-9][0-9][0-9]{8,9}$'
  ),
  target_leads as materialized (
    select distinct l.id, l.wa_identity_id, l.conversation_key,
           l.legacy_conversation_key, l.numero
    from public.lead l
    cross join params p
    left join resolved r on true
    where l.id_empresa = p.id_empresa
      and (
        l.id = r.lead_id
        or (p.id_empresa = 41 and public.crm_phone_match_key(l.numero) in (select phone from prospect_phones)
            and (p.wa_user_id is null or l.wa_user_id is null or l.wa_user_id = p.wa_user_id))
        or (r.wa_identity_id is not null and l.wa_identity_id = r.wa_identity_id)
        or (
          p.telefone is not null
          and regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g') = p.telefone
        )
      )
  ),
  target_crm_leads as materialized (
    select distinct cl.id
    from public.crm_leads cl
    cross join params p
    left join resolved r on true
    where cl.id_empresa = p.id_empresa
      and (
        cl.lead_id in (select id from target_leads)
        or cl.id = r.crm_lead_id
        or (p.id_empresa = 41 and public.crm_phone_match_key(cl.telefone) in (select phone from prospect_phones)
            and (p.wa_user_id is null or cl.wa_user_id is null or cl.wa_user_id = p.wa_user_id))
        or (r.wa_identity_id is not null and cl.wa_identity_id = r.wa_identity_id)
      )
  ),
  target_identities as materialized (
    select distinct i.id, i.conversation_key, i.legacy_conversation_key, i.telefone
    from public.wa_contact_identities i
    cross join params p
    where i.id_empresa = p.id_empresa
      and (
        i.id in (select id from seed_identities)
        or i.lead_id in (select id from target_leads)
        or i.crm_lead_id in (select id from target_crm_leads)
        or i.id in (
          select wa_identity_id from target_leads where wa_identity_id is not null
        )
      )
  ),
  target_session_keys as materialized (
    select distinct key
    from (
      select r.conversation_key as key from resolved r
      union all
      select r.legacy_conversation_key from resolved r
      union all
      select r.active_session_key from resolved r
      union all
      select l.conversation_key from target_leads l
      union all
      select l.legacy_conversation_key from target_leads l
      union all
      select regexp_replace(l.numero, '[^0-9]', '', 'g') || p.id_empresa::text
        from target_leads l cross join params p
        where nullif(regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g'), '') is not null
      union all
      select i.conversation_key from target_identities i
      union all
      select i.legacy_conversation_key from target_identities i
      union all
      select regexp_replace(i.telefone, '[^0-9]', '', 'g') || p.id_empresa::text
        from target_identities i cross join params p
        where nullif(regexp_replace(coalesce(i.telefone, ''), '[^0-9]', '', 'g'), '') is not null
      union all
      select p.telefone || p.id_empresa::text
        from params p where p.telefone is not null
    ) keys
    where nullif(btrim(key), '') is not null
  )
  select array(select id from target_leads),
         array(select id from target_crm_leads),
         array(select id from target_identities),
         array(select key from target_session_keys order by key),
         array(select phone from prospect_phones)
    into v_leads, v_crm, v_identities, v_keys, v_phones;

  -- Serialize resets and FK writers for these parents before reading the dependent events.
  perform id from public.lead where id = any (v_leads) order by id for update;
  select array(
    select m.id from public.wa_messages m
    where (m.tenant_id = p_empresa or m.tenant_id is null)
      and (m.wa_identity_id = any (v_identities)
           or m.conversation_key = any (v_keys)
           or m.legacy_conversation_key = any (v_keys))
    order by m.id for update
  ) into v_messages;

  delete from public.followup_completion_events_v2 e
  where e.lead_id = any (v_leads);
  get diagnostics conclusoes_followup_excluidas = row_count;

  delete from public.followup_crm_events_v2 e
  where e.lead_id = any (v_leads)
     or e.wa_message_id = any (v_messages);
  get diagnostics eventos_followup_excluidos = row_count;

  delete from private.external_qualification_jobs j
  where j.lead_id = any (v_leads);
  get diagnostics qualificacoes_externas_excluidas = row_count;

  delete from public.n8n_chat_conversas c
  where (c.id_empresa = p_empresa or c.id_empresa is null)
    and (c.wa_identity_id = any (v_identities)
     or c.numero = any (v_keys)
     or c.conversation_key = any (v_keys)
     or c.legacy_conversation_key = any (v_keys));
  get diagnostics memorias_excluidas = row_count;

  delete from public.wa_messages m
  where m.id = any (v_messages);
  get diagnostics mensagens_whatsapp_excluidas = row_count;

  delete from public.wa_contact_identities i
  where i.id = any (v_identities);
  get diagnostics identidades_excluidas = row_count;

  delete from private.qualified_whatsapp_alerts a
  where a.id_empresa = p_empresa
    and (
      a.crm_lead_id = any (v_crm)
      or a.dispatch_id in (
        select q.id from public.crm_external_dispatch_queue q
        where q.id_empresa = p_empresa
          and q.crm_lead_id = any (v_crm)
      )
    );
  get diagnostics alertas_whatsapp_excluidos = row_count;

  delete from public.crm_external_crm_send_logs s
  where p_empresa = 41 and s.id_empresa = p_empresa
    and s.lead_id = any (v_crm);
  get diagnostics envios_cv_excluidos = row_count;

  delete from private.inocoop_prospect_cv_activation a
  where p_empresa = 41 and a.id_empresa = p_empresa
    and (a.lead_id = any (v_leads)
         or (a.lead_id is null and a.phone_key = any (v_phones)));
  get diagnostics ativacoes_cv_excluidas = row_count;

  delete from public.crm_leads cl
  where cl.id = any (v_crm);
  get diagnostics leads_crm_excluidos = row_count;

  delete from public.lead l
  where l.id = any (v_leads);
  get diagnostics leads_excluidos = row_count;

  leads_encontrados := cardinality(v_leads);
  identidades_encontradas := cardinality(v_identities);
  chaves_encontradas := cardinality(v_keys);
  chaves_sessao := to_jsonb(v_keys);
  return next;
end;
$reset$;

revoke all on function private.reset_whatsapp_lead(bigint,text,text) from public, anon, authenticated;
grant execute on function private.reset_whatsapp_lead(bigint,text,text) to service_role;
