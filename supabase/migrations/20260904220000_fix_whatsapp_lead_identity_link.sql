-- Mantém a chave legada compatível com a sessão histórica do n8n e garante
-- o vínculo bidirecional entre lead e identidade WhatsApp.

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
      -- O telefone fornecido pelo fluxo já passou pela normalização brasileira.
      -- Ele deve prevalecer sobre o wa_id bruto da Meta quando estiver disponível.
      coalesce(
        p.telefone,
        nullif(regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g'), ''),
        nullif(regexp_replace(coalesce(i.telefone, ''), '[^0-9]', '', 'g'), '')
      ) as telefone,
      coalesce(
        l.conversation_key,
        i.conversation_key,
        case when i.id is not null then 'wa:v2:' || i.id::text else null end
      ) as conversation_key,
      coalesce(
        l.legacy_conversation_key,
        case when p.telefone is not null
          then p.telefone || p.id_empresa::text
          else null
        end,
        i.legacy_conversation_key,
        case
          when nullif(regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g'), '') is not null
          then regexp_replace(l.numero, '[^0-9]', '', 'g') || p.id_empresa::text
          when nullif(regexp_replace(coalesce(i.telefone, ''), '[^0-9]', '', 'g'), '') is not null
          then regexp_replace(i.telefone, '[^0-9]', '', 'g') || p.id_empresa::text
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
  'Resolve BSUID/telefone por empresa e preserva a sessão histórica baseada no telefone normalizado do fluxo.';

revoke all on function public.wa_resolve_conversation_identity(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.wa_resolve_conversation_identity(bigint, text, text)
  to service_role;

create or replace function public.wa_sync_lead_contact_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_identity public.wa_contact_identities%rowtype;
  v_phone text;
begin
  if tg_op = 'UPDATE'
     and old.wa_identity_id is distinct from new.wa_identity_id
     and old.wa_identity_id is not null then
    update public.wa_contact_identities i
    set lead_id = null,
        updated_at = now()
    where i.id = old.wa_identity_id
      and i.lead_id = old.id;
  end if;

  if new.wa_identity_id is null then
    return new;
  end if;

  select i.*
    into v_identity
  from public.wa_contact_identities i
  where i.id = new.wa_identity_id
    and i.id_empresa = new.id_empresa;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'wa_identity_id não pertence à empresa do lead';
  end if;

  v_phone := nullif(
    regexp_replace(coalesce(new.numero, ''), '[^0-9]', '', 'g'),
    ''
  );

  new.wa_user_id := coalesce(new.wa_user_id, v_identity.wa_user_id);
  new.wa_parent_user_id := coalesce(new.wa_parent_user_id, v_identity.wa_parent_user_id);
  new.wa_username := coalesce(new.wa_username, v_identity.username);
  new.conversation_key := coalesce(
    new.conversation_key,
    v_identity.conversation_key,
    'wa:v2:' || new.wa_identity_id::text
  );
  new.legacy_conversation_key := coalesce(
    case when v_phone is not null then v_phone || new.id_empresa::text else null end,
    new.legacy_conversation_key,
    v_identity.legacy_conversation_key
  );

  update public.wa_contact_identities i
  set lead_id = new.id,
      conversation_key = new.conversation_key,
      legacy_conversation_key = new.legacy_conversation_key,
      updated_at = now()
  where i.id = new.wa_identity_id;

  return new;
end;
$$;

revoke all on function public.wa_sync_lead_contact_identity()
  from public, anon, authenticated;
grant execute on function public.wa_sync_lead_contact_identity()
  to service_role;

drop trigger if exists trg_wa_sync_lead_contact_identity on public.lead;
create trigger trg_wa_sync_lead_contact_identity
before insert or update of wa_identity_id
on public.lead
for each row
execute function public.wa_sync_lead_contact_identity();

-- Repara os leads já vinculados, usando exatamente a chave de sessão histórica:
-- telefone normalizado do lead + id da empresa.
update public.lead l
set conversation_key = coalesce(
      l.conversation_key,
      i.conversation_key,
      'wa:v2:' || i.id::text
    ),
    legacy_conversation_key = coalesce(
      case
        when nullif(regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g'), '') is not null
        then regexp_replace(l.numero, '[^0-9]', '', 'g') || l.id_empresa::text
        else null
      end,
      l.legacy_conversation_key,
      i.legacy_conversation_key
    )
from public.wa_contact_identities i
where i.id = l.wa_identity_id
  and i.id_empresa = l.id_empresa
  and (
    l.conversation_key is distinct from coalesce(
      l.conversation_key,
      i.conversation_key,
      'wa:v2:' || i.id::text
    )
    or l.legacy_conversation_key is distinct from coalesce(
      case
        when nullif(regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g'), '') is not null
        then regexp_replace(l.numero, '[^0-9]', '', 'g') || l.id_empresa::text
        else null
      end,
      l.legacy_conversation_key,
      i.legacy_conversation_key
    )
  );

update public.wa_contact_identities i
set lead_id = l.id,
    conversation_key = coalesce(l.conversation_key, i.conversation_key),
    legacy_conversation_key = coalesce(l.legacy_conversation_key, i.legacy_conversation_key),
    updated_at = now()
from public.lead l
where l.wa_identity_id = i.id
  and l.id_empresa = i.id_empresa
  and (
    i.lead_id is distinct from l.id
    or i.conversation_key is distinct from coalesce(l.conversation_key, i.conversation_key)
    or i.legacy_conversation_key is distinct from coalesce(l.legacy_conversation_key, i.legacy_conversation_key)
  );
