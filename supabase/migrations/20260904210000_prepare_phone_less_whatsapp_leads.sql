-- Fundação aditiva para leads de WhatsApp sem telefone.
-- Nesta fase numero permanece NOT NULL. A função só cria sem telefone quando
-- p_allow_without_phone=true E uma migração posterior remover o NOT NULL.

alter table public.lead
  drop constraint if exists lead_has_phone_or_wa_identity;

alter table public.lead
  add constraint lead_has_phone_or_wa_identity
  check (
    nullif(regexp_replace(coalesce(numero, ''), '[^0-9]', '', 'g'), '') is not null
    or wa_identity_id is not null
  ) not valid;

alter table public.lead
  validate constraint lead_has_phone_or_wa_identity;

create unique index if not exists lead_empresa_wa_identity_uidx
  on public.lead (id_empresa, wa_identity_id)
  where wa_identity_id is not null;

create or replace function public.wa_get_or_create_lead(
  p_id_empresa bigint,
  p_wa_user_id text default null,
  p_telefone text default null,
  p_nome text default null,
  p_id_empreendimento bigint default null,
  p_id_crm text default null,
  p_create_if_missing boolean default true,
  p_allow_without_phone boolean default false
)
returns table (
  lead_id bigint,
  created boolean,
  outcome text,
  wa_identity_id uuid,
  wa_user_id text,
  telefone text,
  conversation_key text,
  legacy_conversation_key text,
  active_session_key text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id text := nullif(btrim(p_wa_user_id), '');
  v_phone text := nullif(
    regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g'),
    ''
  );
  v_name text := nullif(btrim(p_nome), '');
  v_identity_id uuid;
  v_conversation_key text;
  v_legacy_key text;
  v_active_key text;
  v_resolved_user_id text;
  v_resolved_phone text;
  v_resolved_lead_id bigint;
  v_lead public.lead%rowtype;
  v_numero_not_null boolean;
begin
  if p_id_empresa is null or not exists (
    select 1 from public.empresa_dados e where e.id = p_id_empresa
  ) then
    raise exception using
      errcode = '22023',
      message = 'id_empresa inválido para wa_get_or_create_lead';
  end if;

  if v_user_id is null and v_phone is null then
    return query select
      null::bigint, false, 'identifier_required'::text,
      null::uuid, null::text, null::text,
      null::text, null::text, null::text;
    return;
  end if;

  -- Serializa somente chamadas referentes ao mesmo contato/empresa para evitar
  -- criação duplicada em webhooks concorrentes.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_id_empresa::text || ':' || coalesce(v_user_id, v_phone),
      0
    )
  );

  select
    r.wa_identity_id,
    r.wa_user_id,
    r.telefone,
    r.conversation_key,
    r.legacy_conversation_key,
    r.active_session_key,
    r.lead_id
  into
    v_identity_id,
    v_resolved_user_id,
    v_resolved_phone,
    v_conversation_key,
    v_legacy_key,
    v_active_key,
    v_resolved_lead_id
  from public.wa_resolve_conversation_identity(
    p_id_empresa,
    v_user_id,
    v_phone
  ) r;

  v_user_id := coalesce(v_resolved_user_id, v_user_id);
  v_phone := coalesce(v_resolved_phone, v_phone);

  if v_resolved_lead_id is not null then
    select l.* into v_lead
    from public.lead l
    where l.id = v_resolved_lead_id
      and l.id_empresa = p_id_empresa;
  end if;

  if v_lead.id is null and v_identity_id is not null then
    select l.* into v_lead
    from public.lead l
    where l.id_empresa = p_id_empresa
      and l.wa_identity_id = v_identity_id
    order by l.updated_at desc nulls last, l.id desc
    limit 1;
  end if;

  if v_lead.id is null and v_phone is not null then
    select l.* into v_lead
    from public.lead l
    where l.id_empresa = p_id_empresa
      and regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g') = v_phone
    order by l.updated_at desc nulls last, l.id desc
    limit 1;
  end if;

  if v_lead.id is not null then
    update public.lead l
    set numero = coalesce(nullif(l.numero, ''), v_phone),
        wa_identity_id = coalesce(l.wa_identity_id, v_identity_id),
        wa_user_id = coalesce(l.wa_user_id, v_user_id),
        wa_parent_user_id = coalesce(l.wa_parent_user_id, i.wa_parent_user_id),
        wa_username = coalesce(l.wa_username, i.username),
        conversation_key = coalesce(l.conversation_key, v_conversation_key),
        legacy_conversation_key = coalesce(l.legacy_conversation_key, v_legacy_key),
        updated_at = now()
    from (select * from public.wa_contact_identities where id = v_identity_id) i
    where l.id = v_lead.id
    returning l.* into v_lead;

    -- O LEFT JOIN implícito acima não atualiza quando ainda não existe uma
    -- identidade. Nesse caso, mantém o lead localizado somente por telefone.
    if not found then
      update public.lead l
      set numero = coalesce(nullif(l.numero, ''), v_phone),
          wa_user_id = coalesce(l.wa_user_id, v_user_id),
          conversation_key = coalesce(l.conversation_key, v_conversation_key),
          legacy_conversation_key = coalesce(l.legacy_conversation_key, v_legacy_key),
          updated_at = now()
      where l.id = v_lead.id
      returning l.* into v_lead;
    end if;

    if v_identity_id is not null then
      update public.wa_contact_identities i
      set lead_id = v_lead.id,
          updated_at = now()
      where i.id = v_identity_id
        and (i.lead_id is null or i.lead_id = v_lead.id);
    end if;

    return query select
      v_lead.id, false, 'found'::text,
      coalesce(v_lead.wa_identity_id, v_identity_id),
      coalesce(v_lead.wa_user_id, v_user_id),
      coalesce(nullif(v_lead.numero, ''), v_phone),
      coalesce(v_lead.conversation_key, v_conversation_key),
      coalesce(v_lead.legacy_conversation_key, v_legacy_key),
      coalesce(
        v_lead.legacy_conversation_key,
        v_legacy_key,
        v_lead.conversation_key,
        v_conversation_key
      );
    return;
  end if;

  if not p_create_if_missing then
    return query select
      null::bigint, false, 'not_found'::text,
      v_identity_id, v_user_id, v_phone,
      v_conversation_key, v_legacy_key, v_active_key;
    return;
  end if;

  if v_phone is null and v_identity_id is null then
    return query select
      null::bigint, false, 'identity_not_captured'::text,
      null::uuid, v_user_id, null::text,
      null::text, null::text, null::text;
    return;
  end if;

  if v_phone is null and not p_allow_without_phone then
    return query select
      null::bigint, false, 'phone_less_creation_disabled'::text,
      v_identity_id, v_user_id, null::text,
      v_conversation_key, v_legacy_key, v_active_key;
    return;
  end if;

  if v_phone is null then
    select a.attnotnull
      into v_numero_not_null
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.lead'::regclass
      and a.attname = 'numero'
      and not a.attisdropped;

    if coalesce(v_numero_not_null, true) then
      return query select
        null::bigint, false, 'schema_not_ready_for_phone_less'::text,
        v_identity_id, v_user_id, null::text,
        v_conversation_key, v_legacy_key, v_active_key;
      return;
    end if;
  end if;

  v_name := coalesce(
    v_name,
    (select nullif(btrim(i.display_name), '') from public.wa_contact_identities i where i.id = v_identity_id),
    (select nullif(btrim(i.username), '') from public.wa_contact_identities i where i.id = v_identity_id),
    'Contato WhatsApp'
  );

  insert into public.lead (
    id_empresa,
    id_empreendimento,
    nome,
    numero,
    ult_message,
    id_crm,
    wa_user_id,
    wa_parent_user_id,
    wa_username,
    conversation_key,
    legacy_conversation_key,
    wa_identity_id
  )
  select
    p_id_empresa,
    p_id_empreendimento,
    v_name,
    v_phone,
    now()::text,
    nullif(btrim(p_id_crm), ''),
    coalesce(v_user_id, i.wa_user_id),
    i.wa_parent_user_id,
    i.username,
    coalesce(v_conversation_key, i.conversation_key),
    coalesce(v_legacy_key, i.legacy_conversation_key),
    v_identity_id
  from (select 1) seed
  left join public.wa_contact_identities i on i.id = v_identity_id
  returning * into v_lead;

  if v_identity_id is not null then
    update public.wa_contact_identities i
    set lead_id = v_lead.id,
        updated_at = now()
    where i.id = v_identity_id;
  end if;

  return query select
    v_lead.id, true, 'created'::text,
    v_lead.wa_identity_id,
    v_lead.wa_user_id,
    v_lead.numero::text,
    v_lead.conversation_key,
    v_lead.legacy_conversation_key,
    coalesce(v_lead.legacy_conversation_key, v_lead.conversation_key);
end;
$$;

comment on function public.wa_get_or_create_lead(
  bigint, text, text, text, bigint, text, boolean, boolean
) is
  'Localiza lead por identidade/BSUID/telefone e prepara criação sem telefone atrás de flag segura.';

revoke all on function public.wa_get_or_create_lead(
  bigint, text, text, text, bigint, text, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.wa_get_or_create_lead(
  bigint, text, text, text, bigint, text, boolean, boolean
) to service_role;
