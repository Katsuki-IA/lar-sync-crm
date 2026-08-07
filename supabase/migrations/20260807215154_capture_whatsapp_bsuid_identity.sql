-- Fase 2 da migração BSUID: captura aditiva de identidade a partir do raw
-- já armazenado em wa_messages. Nenhuma chave de conversa é alterada.

create index if not exists empresa_dados_id_phone_number_idx
  on public.empresa_dados (id_phone_number)
  where id_phone_number is not null;

create index if not exists empresa_dados_id_meta_account_idx
  on public.empresa_dados (id_meta_account)
  where id_meta_account is not null;

create index if not exists credentials_waba_id_idx
  on public.credentials (waba_id)
  where waba_id is not null;

create or replace function public.wa_capture_contact_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_contact jsonb;
  v_profile jsonb;
  v_entry_id text;
  v_user_id text;
  v_parent_user_id text;
  v_username text;
  v_display_name text;
  v_phone text;
  v_id_empresa bigint;
  v_lead_id bigint;
  v_crm_lead_id bigint;
  v_identity_id uuid;
begin
  if new.direction is distinct from 'inbound' then
    return new;
  end if;

  v_contact := coalesce(new.raw->'value'->'contacts'->0, '{}'::jsonb);
  v_profile := coalesce(v_contact->'profile', '{}'::jsonb);
  v_entry_id := nullif(btrim(new.raw->'entry'->>'id'), '');

  v_user_id := coalesce(
    nullif(btrim(new.from_user_id), ''),
    nullif(btrim(v_contact->>'user_id'), ''),
    nullif(btrim(v_contact->>'bsuid'), ''),
    nullif(btrim(new.raw->'message'->>'user_id'), '')
  );

  v_parent_user_id := coalesce(
    nullif(btrim(v_contact->>'parent_user_id'), ''),
    nullif(btrim(new.raw->'message'->>'parent_user_id'), '')
  );

  v_username := coalesce(
    nullif(btrim(new.from_username), ''),
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
    when coalesce(new.from_wa_id, '') ~ '^\+?[0-9]{7,20}$'
      then regexp_replace(new.from_wa_id, '[^0-9]', '', 'g')
    else null
  end;

  -- Colunas novas são preenchidas de forma aditiva. from_wa_id permanece intacto.
  new.from_user_id := coalesce(v_user_id, new.from_user_id);
  new.from_username := coalesce(v_username, new.from_username);

  -- Sem BSUID não criamos uma identidade parcial por telefone, evitando duplicatas.
  if v_user_id is null then
    return new;
  end if;

  select e.id
    into v_id_empresa
  from public.empresa_dados e
  where e.id_phone_number = new.phone_number_id
  order by e.id
  limit 1;

  if v_id_empresa is null and v_entry_id is not null then
    select c.id_empresa
      into v_id_empresa
    from public.credentials c
    where c.waba_id = v_entry_id
    order by c.id
    limit 1;
  end if;

  if v_id_empresa is null and v_entry_id is not null then
    select e.id
      into v_id_empresa
    from public.empresa_dados e
    where e.id_meta_account = v_entry_id
    order by e.id
    limit 1;
  end if;

  -- Mantém a mensagem principal funcionando mesmo quando a empresa ainda não
  -- estiver mapeada para esse phone_number_id/WABA.
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

  insert into public.wa_contact_identities (
    id_empresa,
    lead_id,
    crm_lead_id,
    business_phone_number_id,
    wa_user_id,
    wa_parent_user_id,
    telefone,
    username,
    display_name,
    first_seen_at,
    last_seen_at,
    raw
  )
  values (
    v_id_empresa,
    v_lead_id,
    v_crm_lead_id,
    new.phone_number_id,
    v_user_id,
    v_parent_user_id,
    v_phone,
    v_username,
    v_display_name,
    coalesce(new.timestamp_meta, new.created_at, now()),
    coalesce(new.timestamp_meta, new.created_at, now()),
    v_contact
  )
  on conflict (id_empresa, wa_user_id)
    where wa_user_id is not null and btrim(wa_user_id) <> ''
  do update set
    lead_id = coalesce(excluded.lead_id, public.wa_contact_identities.lead_id),
    crm_lead_id = coalesce(excluded.crm_lead_id, public.wa_contact_identities.crm_lead_id),
    business_phone_number_id = coalesce(
      excluded.business_phone_number_id,
      public.wa_contact_identities.business_phone_number_id
    ),
    wa_parent_user_id = coalesce(
      excluded.wa_parent_user_id,
      public.wa_contact_identities.wa_parent_user_id
    ),
    telefone = coalesce(excluded.telefone, public.wa_contact_identities.telefone),
    username = coalesce(excluded.username, public.wa_contact_identities.username),
    display_name = coalesce(excluded.display_name, public.wa_contact_identities.display_name),
    last_seen_at = greatest(
      excluded.last_seen_at,
      public.wa_contact_identities.last_seen_at
    ),
    raw = public.wa_contact_identities.raw || excluded.raw,
    updated_at = now()
  returning id into v_identity_id;

  new.wa_identity_id := v_identity_id;

  if v_lead_id is not null then
    update public.lead
    set wa_user_id = v_user_id,
        wa_parent_user_id = coalesce(v_parent_user_id, wa_parent_user_id),
        wa_username = coalesce(v_username, wa_username),
        wa_identity_id = v_identity_id
    where id = v_lead_id;
  end if;

  if v_crm_lead_id is not null then
    update public.crm_leads
    set wa_user_id = v_user_id,
        wa_parent_user_id = coalesce(v_parent_user_id, wa_parent_user_id),
        wa_username = coalesce(v_username, wa_username),
        wa_identity_id = v_identity_id
    where id = v_crm_lead_id;
  end if;

  return new;
exception
  when others then
    -- A captura de identidade nunca pode interromper o processamento atual.
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
  'Captura BSUID, telefone e username sem alterar from_wa_id ou chaves de conversa.';
