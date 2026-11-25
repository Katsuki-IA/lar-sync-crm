with
params as materialized (
  select
    $1::bigint as id_empresa,
    nullif(regexp_replace(coalesce($2::text, ''), '[^0-9]', '', 'g'), '') as telefone,
    nullif(btrim($3::text), '') as wa_user_id
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
),
target_messages as materialized (
  select distinct m.id, m.message_id
  from public.wa_messages m
  where m.wa_identity_id in (select id from target_identities)
     or m.conversation_key in (select key from target_session_keys)
     or m.legacy_conversation_key in (select key from target_session_keys)
),
deleted_completion_events as (
  delete from public.followup_completion_events_v2 e
  where e.lead_id in (select id from target_leads)
  returning e.id
),
deleted_crm_events as (
  delete from public.followup_crm_events_v2 e
  where e.lead_id in (select id from target_leads)
     or e.wa_message_id in (select id from target_messages)
  returning e.id
),
deleted_external_qualification_jobs as (
  delete from private.external_qualification_jobs j
  where j.lead_id in (select id from target_leads)
  returning j.id
),
deleted_chat_memory as (
  delete from public.n8n_chat_conversas c
  where c.wa_identity_id in (select id from target_identities)
     or c.numero in (select key from target_session_keys)
     or c.conversation_key in (select key from target_session_keys)
     or c.legacy_conversation_key in (select key from target_session_keys)
  returning c.id
),
deleted_wa_messages as (
  delete from public.wa_messages m
  where m.id in (select id from target_messages)
    and (select count(*) from deleted_crm_events) >= 0
  returning m.id
),
deleted_contact_identities as (
  delete from public.wa_contact_identities i
  where i.id in (select id from target_identities)
    and (select count(*) from deleted_chat_memory) >= 0
    and (select count(*) from deleted_wa_messages) >= 0
  returning i.id
),
deleted_qualified_whatsapp_alerts as (
  delete from private.qualified_whatsapp_alerts a
  using params p
  where a.id_empresa = p.id_empresa
    and (
      a.crm_lead_id in (select id from target_crm_leads)
      or a.dispatch_id in (
        select q.id from public.crm_external_dispatch_queue q
        where q.id_empresa = p.id_empresa
          and q.crm_lead_id in (select id from target_crm_leads)
      )
    )
  returning a.id
),
deleted_cv_sends as (
  delete from public.crm_external_crm_send_logs s using params p
  where p.id_empresa = 41 and s.id_empresa = p.id_empresa
    and s.lead_id in (select id from target_crm_leads)
  returning s.id
),
deleted_cv_activations as (
  delete from private.inocoop_prospect_cv_activation a using params p
  where p.id_empresa = 41 and a.id_empresa = p.id_empresa
    and (a.lead_id in (select id from target_leads)
         or (a.lead_id is null and a.phone_key in (select phone from prospect_phones)))
  returning a.phone_key
),
deleted_crm_leads as (
  delete from public.crm_leads cl
  where cl.id in (select id from target_crm_leads)
    and (select count(*) from deleted_cv_sends) >= 0
    and (select count(*) from deleted_cv_activations) >= 0
    and (select count(*) from deleted_qualified_whatsapp_alerts) >= 0
    and (select count(*) from deleted_crm_events) >= 0
    and (select count(*) from deleted_contact_identities) >= 0
  returning cl.id
),
deleted_leads as (
  delete from public.lead l
  where l.id in (select id from target_leads)
    and (select count(*) from deleted_external_qualification_jobs) >= 0
    and (select count(*) from deleted_completion_events) >= 0
    and (select count(*) from deleted_crm_events) >= 0
    and (select count(*) from deleted_contact_identities) >= 0
    and (select count(*) from deleted_crm_leads) >= 0
  returning l.id
)
select
  (select count(*) from target_leads) as leads_encontrados,
  (select count(*) from target_identities) as identidades_encontradas,
  (select count(*) from target_session_keys) as chaves_encontradas,
  (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from target_session_keys) as chaves_sessao,
  (select count(*) from deleted_external_qualification_jobs) as qualificacoes_externas_excluidas,
  (select count(*) from deleted_completion_events) as conclusoes_followup_excluidas,
  (select count(*) from deleted_crm_events) as eventos_followup_excluidos,
  (select count(*) from deleted_chat_memory) as memorias_excluidas,
  (select count(*) from deleted_wa_messages) as mensagens_whatsapp_excluidas,
  (select count(*) from deleted_contact_identities) as identidades_excluidas,
  (select count(*) from deleted_qualified_whatsapp_alerts) as alertas_whatsapp_excluidos,
  (select count(*) from deleted_cv_sends) as envios_cv_excluidos,
  (select count(*) from deleted_cv_activations) as ativacoes_cv_excluidas,
  (select count(*) from deleted_crm_leads) as leads_crm_excluidos,
  (select count(*) from deleted_leads) as leads_excluidos;
