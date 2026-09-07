-- Resolve BSUID/telefone para uma identidade e para as duas chaves de conversa.
-- A chave ativa permanece legada sempre que há telefone, preservando a memória
-- atual do n8n. Contatos sem telefone usam a chave canônica wa:v2:*.

create or replace function public.wa_resolve_conversation_identity(
  p_id_empresa bigint,
  p_wa_user_id text default null,
  p_telefone text default null
)
returns table (
  id_empresa bigint,
  wa_identity_id uuid,
  wa_user_id text,
  wa_parent_user_id text,
  wa_username text,
  telefone text,
  conversation_key text,
  legacy_conversation_key text,
  active_session_key text,
  lead_id bigint,
  crm_lead_id bigint,
  atendimento_humano boolean,
  resolution_source text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      p_id_empresa as id_empresa,
      nullif(btrim(p_wa_user_id), '') as wa_user_id,
      nullif(regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g'), '') as telefone
  ),
  identity_candidates as (
    select i.*, 1 as priority, 'bsuid_alias'::text as source
    from params p
    join public.wa_contact_identity_aliases a
      on a.id_empresa = p.id_empresa
     and a.wa_user_id = p.wa_user_id
    join public.wa_contact_identities i
      on i.id = a.wa_identity_id
    where p.wa_user_id is not null

    union all

    select i.*, 2 as priority, 'bsuid_current'::text as source
    from params p
    join public.wa_contact_identities i
      on i.id_empresa = p.id_empresa
     and i.wa_user_id = p.wa_user_id
    where p.wa_user_id is not null

    union all

    select i.*, 3 as priority, 'phone_identity'::text as source
    from params p
    join public.wa_contact_identities i
      on i.id_empresa = p.id_empresa
     and regexp_replace(coalesce(i.telefone, ''), '[^0-9]', '', 'g') = p.telefone
    where p.telefone is not null
  ),
  identity_choice as (
    select c.*
    from identity_candidates c
    order by c.priority, c.last_seen_at desc, c.id
    limit 1
  ),
  lead_choice as (
    select l.*
    from params p
    left join identity_choice i on true
    join public.lead l
      on l.id_empresa = p.id_empresa
     and (
       (i.lead_id is not null and l.id = i.lead_id)
       or (i.id is not null and l.wa_identity_id = i.id)
       or (
         p.telefone is not null
         and regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g') = p.telefone
       )
     )
    order by
      case
        when i.lead_id is not null and l.id = i.lead_id then 1
        when i.id is not null and l.wa_identity_id = i.id then 2
        else 3
      end,
      l.updated_at desc nulls last,
      l.id desc
    limit 1
  ),
  resolved as (
    select
      p.id_empresa,
      i.id as wa_identity_id,
      coalesce(i.wa_user_id, p.wa_user_id, l.wa_user_id) as wa_user_id,
      coalesce(i.wa_parent_user_id, l.wa_parent_user_id) as wa_parent_user_id,
      coalesce(i.username, l.wa_username) as wa_username,
      coalesce(
        nullif(regexp_replace(coalesce(i.telefone, ''), '[^0-9]', '', 'g'), ''),
        nullif(regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g'), ''),
        p.telefone
      ) as telefone,
      coalesce(
        i.conversation_key,
        case when i.id is not null then 'wa:v2:' || i.id::text else null end
      ) as conversation_key,
      coalesce(
        i.legacy_conversation_key,
        l.legacy_conversation_key,
        case
          when coalesce(
            nullif(regexp_replace(coalesce(i.telefone, ''), '[^0-9]', '', 'g'), ''),
            nullif(regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g'), ''),
            p.telefone
          ) is not null
          then coalesce(
            nullif(regexp_replace(coalesce(i.telefone, ''), '[^0-9]', '', 'g'), ''),
            nullif(regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g'), ''),
            p.telefone
          ) || p.id_empresa::text
          else null
        end
      ) as legacy_conversation_key,
      l.id as lead_id,
      i.crm_lead_id,
      l.atendimento_humano,
      coalesce(i.source, case when l.id is not null then 'phone_lead' else 'unresolved' end) as resolution_source
    from params p
    left join identity_choice i on true
    left join lead_choice l on true
    where p.id_empresa is not null
  )
  select
    r.id_empresa,
    r.wa_identity_id,
    r.wa_user_id,
    r.wa_parent_user_id,
    r.wa_username,
    r.telefone,
    r.conversation_key,
    r.legacy_conversation_key,
    coalesce(r.legacy_conversation_key, r.conversation_key) as active_session_key,
    r.lead_id,
    r.crm_lead_id,
    r.atendimento_humano,
    r.resolution_source
  from resolved r;
$$;

comment on function public.wa_resolve_conversation_identity(bigint, text, text) is
  'Resolve BSUID/telefone por empresa e mantém a sessão legada ativa quando disponível.';

revoke all on function public.wa_resolve_conversation_identity(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.wa_resolve_conversation_identity(bigint, text, text)
  to service_role;
