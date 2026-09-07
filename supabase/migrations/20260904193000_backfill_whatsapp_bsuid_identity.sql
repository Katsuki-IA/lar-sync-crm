-- Backfill não destrutivo da identidade BSUID do WhatsApp.
-- Mantém todas as chaves e dados legados; preenche somente a camada nova.
-- Em produção, os dados foram aplicados em lotes limitados em 2026-09-04;
-- o SQL permanece idempotente para registrar/reproduzir o estado em outros ambientes.

-- Mapeia phone_number_id apenas quando a relação é unívoca nos dois sentidos:
-- um ID da Meta identifica uma empresa e essa empresa possui um único candidato.
with pairs as (
  select distinct
    wm.phone_number_id,
    e.id as id_empresa
  from public.wa_messages wm
  join public.empresa_dados e
    on e.id_phone_number is null
   and regexp_replace(
         coalesce(wm.raw->'value'->'metadata'->>'display_phone_number', ''),
         '[^0-9]', '', 'g'
       ) <> ''
   and regexp_replace(
         coalesce(wm.raw->'value'->'metadata'->>'display_phone_number', ''),
         '[^0-9]', '', 'g'
       ) in (
         regexp_replace(coalesce(e.numero, ''), '[^0-9]', '', 'g'),
         regexp_replace(coalesce(e.numero_superior, ''), '[^0-9]', '', 'g')
       )
  where nullif(btrim(wm.phone_number_id), '') is not null
    and not exists (
      select 1
      from public.empresa_dados mapped
      where mapped.id_phone_number = wm.phone_number_id
    )
),
safe_pairs as (
  select p.*
  from pairs p
  where (select count(*) from pairs x where x.phone_number_id = p.phone_number_id) = 1
    and (select count(*) from pairs x where x.id_empresa = p.id_empresa) = 1
)
update public.empresa_dados e
set id_phone_number = safe.phone_number_id,
    updated_at = now()
from safe_pairs safe
where e.id = safe.id_empresa
  and e.id_phone_number is null;

-- Prepara as identidades que já haviam sido capturadas antes desta fase.
update public.wa_contact_identities
set conversation_key = coalesce(conversation_key, 'wa:v2:' || id::text),
    legacy_conversation_key = coalesce(
      legacy_conversation_key,
      case when nullif(btrim(telefone), '') is not null
        then telefone || id_empresa::text
        else null
      end
    ),
    updated_at = now()
where conversation_key is null
   or (
     legacy_conversation_key is null
     and nullif(btrim(telefone), '') is not null
   );

insert into public.wa_contact_identity_aliases (
  id_empresa,
  wa_identity_id,
  wa_user_id,
  is_current,
  first_seen_at,
  last_seen_at,
  raw
)
select
  i.id_empresa,
  i.id,
  i.wa_user_id,
  true,
  i.first_seen_at,
  i.last_seen_at,
  i.raw
from public.wa_contact_identities i
where nullif(btrim(i.wa_user_id), '') is not null
on conflict (id_empresa, wa_user_id) do update set
  wa_identity_id = excluded.wa_identity_id,
  last_seen_at = greatest(
    excluded.last_seen_at,
    public.wa_contact_identity_aliases.last_seen_at
  ),
  raw = public.wa_contact_identity_aliases.raw || excluded.raw,
  updated_at = now();

-- Reexecuta o trigger de identidade somente nas mensagens inbound que possuem
-- indício de BSUID e ainda não foram vinculadas. Nenhuma mensagem é removida.
update public.wa_messages wm
set from_user_id = wm.from_user_id
where wm.direction = 'inbound'
  and wm.wa_identity_id is null
  and coalesce(
    (
      select min(e.id)
      from public.empresa_dados e
      where e.id_phone_number = wm.phone_number_id
      having count(distinct e.id) = 1
    ),
    (
      select min(c.id_empresa)
      from public.credentials c
      where c.waba_id = nullif(btrim(wm.raw->'entry'->>'id'), '')
      having count(distinct c.id_empresa) = 1
    ),
    (
      select min(e.id)
      from public.empresa_dados e
      where e.id_meta_account = nullif(btrim(wm.raw->'entry'->>'id'), '')
      having count(distinct e.id) = 1
    ),
    (
      select min(e.id)
      from public.empresa_dados e
      where regexp_replace(
              coalesce(wm.raw->'value'->'metadata'->>'display_phone_number', ''),
              '[^0-9]', '', 'g'
            ) <> ''
        and regexp_replace(
              coalesce(wm.raw->'value'->'metadata'->>'display_phone_number', ''),
              '[^0-9]', '', 'g'
            ) in (
              regexp_replace(coalesce(e.numero, ''), '[^0-9]', '', 'g'),
              regexp_replace(coalesce(e.numero_superior, ''), '[^0-9]', '', 'g')
            )
      having count(distinct e.id) = 1
    )
  ) is not null
  and coalesce(
    nullif(btrim(wm.from_user_id), ''),
    nullif(btrim(wm.raw->'message'->>'from_user_id'), ''),
    nullif(btrim(wm.raw->'message'->>'user_id'), ''),
    nullif(btrim(wm.raw->'message'->'system'->>'user_id'), ''),
    nullif(btrim(wm.raw->'value'->'contacts'->0->>'user_id'), ''),
    nullif(btrim(wm.raw->'value'->'contacts'->0->>'bsuid'), '')
  ) is not null;

-- Propaga as chaves apenas para registros que já possuem identidade confirmada.
update public.wa_messages wm
set conversation_key = i.conversation_key,
    legacy_conversation_key = coalesce(
      wm.legacy_conversation_key,
      i.legacy_conversation_key
    )
from public.wa_contact_identities i
where wm.wa_identity_id = i.id
  and (
    wm.conversation_key is distinct from i.conversation_key
    or (
      wm.legacy_conversation_key is null
      and i.legacy_conversation_key is not null
    )
  );

update public.lead l
set wa_user_id = i.wa_user_id,
    wa_parent_user_id = coalesce(i.wa_parent_user_id, l.wa_parent_user_id),
    wa_username = coalesce(i.username, l.wa_username),
    conversation_key = i.conversation_key,
    legacy_conversation_key = coalesce(
      i.legacy_conversation_key,
      l.legacy_conversation_key
    )
from public.wa_contact_identities i
where l.wa_identity_id = i.id
  and (
    l.wa_user_id is distinct from i.wa_user_id
    or l.conversation_key is distinct from i.conversation_key
    or (
      l.legacy_conversation_key is null
      and i.legacy_conversation_key is not null
    )
  );

update public.crm_leads l
set wa_user_id = i.wa_user_id,
    wa_parent_user_id = coalesce(i.wa_parent_user_id, l.wa_parent_user_id),
    wa_username = coalesce(i.username, l.wa_username),
    conversation_key = i.conversation_key,
    legacy_conversation_key = coalesce(
      i.legacy_conversation_key,
      l.legacy_conversation_key
    )
from public.wa_contact_identities i
where l.wa_identity_id = i.id
  and (
    l.wa_user_id is distinct from i.wa_user_id
    or l.conversation_key is distinct from i.conversation_key
    or (
      l.legacy_conversation_key is null
      and i.legacy_conversation_key is not null
    )
  );
