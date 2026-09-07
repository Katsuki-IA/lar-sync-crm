-- Endurece a captura de identidade do WhatsApp sem trocar as chaves de sessão
-- atualmente usadas pelos fluxos. A chave wa:v2:* fica pronta para a migração
-- posterior do Hub/Redis e a chave legada continua disponível em paralelo.

create table if not exists public.wa_contact_identity_aliases (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  wa_identity_id uuid not null references public.wa_contact_identities(id) on delete cascade,
  wa_user_id text not null,
  is_current boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wa_contact_identity_aliases_user_not_blank
    check (btrim(wa_user_id) <> ''),
  constraint wa_contact_identity_aliases_empresa_user_key
    unique (id_empresa, wa_user_id)
);

comment on table public.wa_contact_identity_aliases is
  'Histórico de BSUIDs associados à mesma identidade interna do WhatsApp.';
comment on column public.wa_contact_identity_aliases.is_current is
  'Indica o BSUID mais recente; aliases antigos continuam resolvendo a identidade.';

create index if not exists wa_contact_identity_aliases_identity_idx
  on public.wa_contact_identity_aliases (wa_identity_id);

drop trigger if exists set_wa_contact_identity_aliases_updated_at
  on public.wa_contact_identity_aliases;
create trigger set_wa_contact_identity_aliases_updated_at
before update on public.wa_contact_identity_aliases
for each row execute function public.handle_updated_at();

alter table public.wa_contact_identity_aliases enable row level security;
revoke all on table public.wa_contact_identity_aliases
  from public, anon, authenticated;
grant select, insert, update, delete on table public.wa_contact_identity_aliases
  to service_role;

create or replace function public.wa_capture_contact_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_value jsonb := coalesce(new.raw->'value', '{}'::jsonb);
  v_message jsonb := coalesce(new.raw->'message', '{}'::jsonb);
  v_system jsonb;
  v_contact jsonb := '{}'::jsonb;
  v_profile jsonb := '{}'::jsonb;
  v_identity_raw jsonb := '{}'::jsonb;
  v_entry_id text;
  v_display_phone text;
  v_message_actor text;
  v_user_id text;
  v_previous_user_id text;
  v_parent_user_id text;
  v_previous_parent_user_id text;
  v_username text;
  v_display_name text;
  v_phone text;
  v_seen_at timestamptz;
  v_id_empresa bigint;
  v_lead_id bigint;
  v_crm_lead_id bigint;
  v_identity_id uuid;
  v_previous_identity_id uuid;
  v_conversation_key text;
  v_legacy_key text;
begin
  if new.direction is distinct from 'inbound' then
    return new;
  end if;

  v_system := coalesce(v_message->'system', '{}'::jsonb);
  v_entry_id := nullif(btrim(new.raw->'entry'->>'id'), '');
  v_display_phone := regexp_replace(
    coalesce(v_value->'metadata'->>'display_phone_number', ''),
    '[^0-9]', '', 'g'
  );
  v_display_phone := nullif(v_display_phone, '');
  v_message_actor := coalesce(
    nullif(btrim(v_message->>'from_user_id'), ''),
    nullif(btrim(v_message->>'user_id'), ''),
    nullif(btrim(v_system->>'user_id'), ''),
    nullif(btrim(v_message->>'from'), ''),
    nullif(btrim(new.from_user_id), ''),
    nullif(btrim(new.from_wa_id), '')
  );

  -- Em payloads com vários contatos, escolhe o contato da mensagem atual.
  select contact_item
    into v_contact
  from jsonb_array_elements(coalesce(v_value->'contacts', '[]'::jsonb)) contact_item
  where v_message_actor is null
     or v_message_actor in (
       nullif(btrim(contact_item->>'user_id'), ''),
       nullif(btrim(contact_item->>'bsuid'), ''),
       nullif(btrim(contact_item->>'wa_id'), ''),
       nullif(btrim(contact_item->>'phone_number'), '')
     )
  limit 1;

  if v_contact is null or v_contact = 'null'::jsonb then
    v_contact := coalesce(v_value->'contacts'->0, '{}'::jsonb);
  end if;

  v_profile := coalesce(v_contact->'profile', '{}'::jsonb);

  v_user_id := coalesce(
    nullif(btrim(new.from_user_id), ''),
    nullif(btrim(v_message->>'from_user_id'), ''),
    nullif(btrim(v_message->>'user_id'), ''),
    nullif(btrim(v_system->>'user_id'), ''),
    nullif(btrim(v_contact->>'user_id'), ''),
    nullif(btrim(v_contact->>'bsuid'), '')
  );

  v_previous_user_id := coalesce(
    nullif(btrim(v_system->>'previous_user_id'), ''),
    nullif(btrim(v_message->>'previous_user_id'), '')
  );

  v_parent_user_id := coalesce(
    nullif(btrim(v_system->>'parent_user_id'), ''),
    nullif(btrim(v_message->>'parent_user_id'), ''),
    nullif(btrim(v_contact->>'parent_user_id'), '')
  );

  v_previous_parent_user_id := coalesce(
    nullif(btrim(v_system->>'previous_parent_user_id'), ''),
    nullif(btrim(v_message->>'previous_parent_user_id'), '')
  );

  v_username := coalesce(
    nullif(btrim(new.from_username), ''),
    nullif(btrim(v_message->>'username'), ''),
    nullif(btrim(v_profile->>'username'), ''),
    nullif(btrim(v_profile->>'user_name'), ''),
    nullif(btrim(v_contact->>'username'), '')
  );

  v_display_name := nullif(btrim(v_profile->>'name'), '');

  v_phone := case
    when coalesce(v_contact->>'phone_number', '') ~ '^\+?[0-9]{7,20}$'
      then regexp_replace(v_contact->>'phone_number', '[^0-9]', '', 'g')
    when coalesce(v_contact->>'wa_id', '') ~ '^\+?[0-9]{7,20}$'
      then regexp_replace(v_contact->>'wa_id', '[^0-9]', '', 'g')
    when coalesce(v_message->>'from', '') ~ '^\+?[0-9]{7,20}$'
      then regexp_replace(v_message->>'from', '[^0-9]', '', 'g')
    when coalesce(v_system->>'wa_id', '') ~ '^\+?[0-9]{7,20}$'
      then regexp_replace(v_system->>'wa_id', '[^0-9]', '', 'g')
    when coalesce(new.from_wa_id, '') ~ '^\+?[0-9]{7,20}$'
      then regexp_replace(new.from_wa_id, '[^0-9]', '', 'g')
    else null
  end;

  v_seen_at := coalesce(new.timestamp_meta, new.created_at, now());
  v_identity_raw := coalesce(v_contact, '{}'::jsonb)
    || case when v_system <> '{}'::jsonb
      then jsonb_build_object('system', v_system)
      else '{}'::jsonb
    end;

  -- Colunas novas são aditivas; from_wa_id continua sendo a referência legada.
  new.from_user_id := coalesce(v_user_id, new.from_user_id);
  new.from_username := coalesce(v_username, new.from_username);

  if v_user_id is null then
    return new;
  end if;

  select min(e.id)
    into v_id_empresa
  from public.empresa_dados e
  where e.id_phone_number = new.phone_number_id
  having count(distinct e.id) = 1;

  -- WABA compartilhado só é aceito quando aponta para uma única empresa.
  if v_id_empresa is null and v_entry_id is not null then
    select min(c.id_empresa)
      into v_id_empresa
    from public.credentials c
    where c.waba_id = v_entry_id
    having count(distinct c.id_empresa) = 1;
  end if;

  if v_id_empresa is null and v_entry_id is not null then
    select min(e.id)
      into v_id_empresa
    from public.empresa_dados e
    where e.id_meta_account = v_entry_id
    having count(distinct e.id) = 1;
  end if;

  if v_id_empresa is null and v_display_phone is not null then
    select min(e.id)
      into v_id_empresa
    from public.empresa_dados e
    where v_display_phone in (
      regexp_replace(coalesce(e.numero, ''), '[^0-9]', '', 'g'),
      regexp_replace(coalesce(e.numero_superior, ''), '[^0-9]', '', 'g')
    )
    having count(distinct e.id) = 1;
  end if;

  -- Uma identidade sem empresa seria insegura em um ambiente multiempresa.
  if v_id_empresa is null then
    return new;
  end if;

  if v_phone is not null then
    select l.id
      into v_lead_id
    from public.lead l
    where l.id_empresa = v_id_empresa
      and l.numero = v_phone
    order by l.updated_at desc nulls last, l.id desc
    limit 1;

    select l.id
      into v_crm_lead_id
    from public.crm_leads l
    where l.id_empresa = v_id_empresa
      and l.telefone = v_phone
    order by l.updated_at desc nulls last, l.id desc
    limit 1;
  end if;

  select coalesce(
    (
      select a.wa_identity_id
      from public.wa_contact_identity_aliases a
      where a.id_empresa = v_id_empresa
        and a.wa_user_id = v_user_id
      limit 1
    ),
    (
      select i.id
      from public.wa_contact_identities i
      where i.id_empresa = v_id_empresa
        and i.wa_user_id = v_user_id
      limit 1
    )
  ) into v_identity_id;

  if v_previous_user_id is not null then
    select coalesce(
      (
        select a.wa_identity_id
        from public.wa_contact_identity_aliases a
        where a.id_empresa = v_id_empresa
          and a.wa_user_id = v_previous_user_id
        limit 1
      ),
      (
        select i.id
        from public.wa_contact_identities i
        where i.id_empresa = v_id_empresa
          and i.wa_user_id = v_previous_user_id
        limit 1
      )
    ) into v_previous_identity_id;
  end if;

  -- Se a Meta rotacionou o BSUID e o novo ainda não existe, reaproveita o UUID
  -- interno anterior. Nenhuma identidade histórica é apagada ou mesclada aqui.
  if v_identity_id is null and v_previous_identity_id is not null then
    v_identity_id := v_previous_identity_id;
  end if;

  if v_identity_id is null then
    insert into public.wa_contact_identities (
      id_empresa, lead_id, crm_lead_id, business_phone_number_id,
      wa_user_id, wa_parent_user_id, telefone, username, display_name,
      first_seen_at, last_seen_at, raw
    ) values (
      v_id_empresa, v_lead_id, v_crm_lead_id, new.phone_number_id,
      v_user_id, v_parent_user_id, v_phone, v_username, v_display_name,
      v_seen_at, v_seen_at, v_identity_raw
    )
    on conflict (id_empresa, wa_user_id)
      where wa_user_id is not null and btrim(wa_user_id) <> ''
    do update set
      lead_id = coalesce(excluded.lead_id, public.wa_contact_identities.lead_id),
      crm_lead_id = coalesce(excluded.crm_lead_id, public.wa_contact_identities.crm_lead_id),
      business_phone_number_id = coalesce(excluded.business_phone_number_id, public.wa_contact_identities.business_phone_number_id),
      wa_parent_user_id = coalesce(excluded.wa_parent_user_id, public.wa_contact_identities.wa_parent_user_id),
      telefone = coalesce(excluded.telefone, public.wa_contact_identities.telefone),
      username = coalesce(excluded.username, public.wa_contact_identities.username),
      display_name = coalesce(excluded.display_name, public.wa_contact_identities.display_name),
      last_seen_at = greatest(excluded.last_seen_at, public.wa_contact_identities.last_seen_at),
      raw = public.wa_contact_identities.raw || excluded.raw,
      updated_at = now()
    returning id into v_identity_id;
  else
    update public.wa_contact_identities
    set lead_id = coalesce(v_lead_id, lead_id),
        crm_lead_id = coalesce(v_crm_lead_id, crm_lead_id),
        business_phone_number_id = coalesce(new.phone_number_id, business_phone_number_id),
        wa_user_id = v_user_id,
        wa_parent_user_id = coalesce(v_parent_user_id, wa_parent_user_id),
        telefone = coalesce(v_phone, telefone),
        username = coalesce(v_username, username),
        display_name = coalesce(v_display_name, display_name),
        last_seen_at = greatest(v_seen_at, last_seen_at),
        raw = raw || v_identity_raw,
        updated_at = now()
    where id = v_identity_id;
  end if;

  v_conversation_key := 'wa:v2:' || v_identity_id::text;
  v_legacy_key := case when v_phone is not null
    then v_phone || v_id_empresa::text
    else null
  end;

  update public.wa_contact_identities
  set conversation_key = v_conversation_key,
      legacy_conversation_key = coalesce(v_legacy_key, legacy_conversation_key),
      updated_at = now()
  where id = v_identity_id;

  insert into public.wa_contact_identity_aliases (
    id_empresa, wa_identity_id, wa_user_id, is_current,
    first_seen_at, last_seen_at, raw
  ) values (
    v_id_empresa, v_identity_id, v_user_id, true,
    v_seen_at, v_seen_at, v_identity_raw
  )
  on conflict (id_empresa, wa_user_id) do update set
    wa_identity_id = excluded.wa_identity_id,
    is_current = true,
    last_seen_at = greatest(excluded.last_seen_at, public.wa_contact_identity_aliases.last_seen_at),
    raw = public.wa_contact_identity_aliases.raw || excluded.raw,
    updated_at = now();

  if v_previous_user_id is not null and v_previous_user_id <> v_user_id then
    update public.wa_contact_identity_aliases
    set is_current = false,
        updated_at = now()
    where wa_identity_id = v_identity_id
      and wa_user_id <> v_user_id;

    insert into public.wa_contact_identity_aliases (
      id_empresa, wa_identity_id, wa_user_id, is_current,
      first_seen_at, last_seen_at, raw
    ) values (
      v_id_empresa, v_identity_id, v_previous_user_id, false,
      v_seen_at, v_seen_at,
      jsonb_build_object(
        'system', v_system,
        'previous_parent_user_id', v_previous_parent_user_id
      )
    )
    on conflict (id_empresa, wa_user_id) do update set
      wa_identity_id = excluded.wa_identity_id,
      is_current = false,
      last_seen_at = greatest(excluded.last_seen_at, public.wa_contact_identity_aliases.last_seen_at),
      raw = public.wa_contact_identity_aliases.raw || excluded.raw,
      updated_at = now();
  end if;

  new.wa_identity_id := v_identity_id;
  new.conversation_key := v_conversation_key;
  new.legacy_conversation_key := coalesce(v_legacy_key, new.legacy_conversation_key);

  if v_lead_id is not null then
    update public.lead
    set wa_user_id = v_user_id,
        wa_parent_user_id = coalesce(v_parent_user_id, wa_parent_user_id),
        wa_username = coalesce(v_username, wa_username),
        wa_identity_id = v_identity_id,
        conversation_key = v_conversation_key,
        legacy_conversation_key = coalesce(v_legacy_key, legacy_conversation_key)
    where id = v_lead_id;
  end if;

  if v_crm_lead_id is not null then
    update public.crm_leads
    set wa_user_id = v_user_id,
        wa_parent_user_id = coalesce(v_parent_user_id, wa_parent_user_id),
        wa_username = coalesce(v_username, wa_username),
        wa_identity_id = v_identity_id,
        conversation_key = v_conversation_key,
        legacy_conversation_key = coalesce(v_legacy_key, legacy_conversation_key)
    where id = v_crm_lead_id;
  end if;

  return new;
exception
  when others then
    -- Captura auxiliar nunca pode interromper o recebimento da mensagem.
    raise warning 'wa identity capture failed for message %: %', new.message_id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.wa_capture_contact_identity()
  from public, anon, authenticated;
grant execute on function public.wa_capture_contact_identity()
  to service_role;

drop trigger if exists trg_wa_capture_contact_identity
  on public.wa_messages;
create trigger trg_wa_capture_contact_identity
before insert or update of raw, from_user_id, from_username, from_wa_id
on public.wa_messages
for each row
when (new.direction = 'inbound')
execute function public.wa_capture_contact_identity();

comment on function public.wa_capture_contact_identity() is
  'Captura e reconcilia BSUID/username, inclusive rotações user_changed_user_id, sem interromper a chave legada.';
