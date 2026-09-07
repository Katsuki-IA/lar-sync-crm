-- Keep the transport ledger (`wa_messages`) as the source of truth while
-- projecting accepted Follow-up V2 messages into the legacy chat history used
-- by the Hub. The wa_message_id link makes the projection idempotent and lets
-- the UI read delivery state without matching by text and timestamp.

alter table public.n8n_chat_conversas
  add column if not exists wa_message_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.n8n_chat_conversas'::pg_catalog.regclass
      and conname = 'n8n_chat_conversas_wa_message_id_fkey'
  ) then
    alter table public.n8n_chat_conversas
      add constraint n8n_chat_conversas_wa_message_id_fkey
      foreign key (wa_message_id)
      references public.wa_messages(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.n8n_chat_conversas'::pg_catalog.regclass
      and conname = 'n8n_chat_conversas_wa_message_id_key'
  ) then
    alter table public.n8n_chat_conversas
      add constraint n8n_chat_conversas_wa_message_id_key unique (wa_message_id);
  end if;
end;
$$;

comment on column public.n8n_chat_conversas.wa_message_id is
  'Idempotent link to the canonical WhatsApp transport row in wa_messages.';

create or replace function public.enrich_followup_wa_message_identity_v2()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lead public.lead%rowtype;
begin
  if coalesce(new.raw ->> 'source', '') <> 'followup_v2'
     or new.tenant_id is null then
    return new;
  end if;

  select l.*
    into v_lead
  from public.lead l
  where l.id_empresa = new.tenant_id
    and (
      (nullif(new.crm_entity_id, '') is not null and l.id_crm = new.crm_entity_id)
      or (new.wa_identity_id is not null and l.wa_identity_id = new.wa_identity_id)
      or (
        new.to_wa_id is not null
        and pg_catalog.regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g') =
            pg_catalog.regexp_replace(new.to_wa_id, '[^0-9]', '', 'g')
      )
    )
  order by
    case when nullif(new.crm_entity_id, '') is not null and l.id_crm = new.crm_entity_id then 0 else 1 end,
    l.updated_at desc,
    l.id desc
  limit 1;

  if found then
    new.wa_identity_id := coalesce(new.wa_identity_id, v_lead.wa_identity_id);
    new.conversation_key := coalesce(nullif(new.conversation_key, ''), v_lead.conversation_key);
    new.legacy_conversation_key := coalesce(nullif(new.legacy_conversation_key, ''), v_lead.legacy_conversation_key);
  end if;

  return new;
end;
$$;

revoke all on function public.enrich_followup_wa_message_identity_v2()
  from public, anon, authenticated;

drop trigger if exists trg_enrich_followup_wa_message_identity_v2
  on public.wa_messages;
create trigger trg_enrich_followup_wa_message_identity_v2
before insert or update of tenant_id, crm_entity_id, to_wa_id, raw,
  wa_identity_id, conversation_key, legacy_conversation_key
on public.wa_messages
for each row
execute function public.enrich_followup_wa_message_identity_v2();

create or replace function public.project_followup_wa_message_to_chat_v2(
  p_wa_message_id uuid
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_message public.wa_messages%rowtype;
  v_lead public.lead%rowtype;
  v_phone text;
  v_conversation_key text;
  v_legacy_conversation_key text;
  v_wa_identity_id uuid;
  v_message_time timestamptz;
begin
  select m.*
    into v_message
  from public.wa_messages m
  where m.id = p_wa_message_id;

  if not found
     or coalesce(v_message.raw ->> 'source', '') <> 'followup_v2'
     or v_message.direction <> 'outbound'
     or v_message.tenant_id is null
     or nullif(v_message.text_body, '') is null
     or v_message.status_current not in ('accepted', 'sent', 'delivered', 'read') then
    return false;
  end if;

  select l.*
    into v_lead
  from public.lead l
  where l.id_empresa = v_message.tenant_id
    and (
      (nullif(v_message.crm_entity_id, '') is not null and l.id_crm = v_message.crm_entity_id)
      or (v_message.wa_identity_id is not null and l.wa_identity_id = v_message.wa_identity_id)
      or (
        v_message.to_wa_id is not null
        and pg_catalog.regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g') =
            pg_catalog.regexp_replace(v_message.to_wa_id, '[^0-9]', '', 'g')
      )
    )
  order by
    case when nullif(v_message.crm_entity_id, '') is not null and l.id_crm = v_message.crm_entity_id then 0 else 1 end,
    l.updated_at desc,
    l.id desc
  limit 1;

  v_phone := nullif(
    pg_catalog.regexp_replace(coalesce(v_message.to_wa_id, v_lead.numero, ''), '[^0-9]', '', 'g'),
    ''
  );
  v_wa_identity_id := coalesce(v_message.wa_identity_id, v_lead.wa_identity_id);
  v_conversation_key := coalesce(nullif(v_message.conversation_key, ''), v_lead.conversation_key);
  v_legacy_conversation_key := coalesce(
    nullif(v_message.legacy_conversation_key, ''),
    v_lead.legacy_conversation_key,
    case when v_phone is not null then v_phone || v_message.tenant_id::text end
  );
  v_message_time := coalesce(
    v_message.sent_at,
    v_message.timestamp_meta,
    v_message.status_last_at,
    v_message.created_at,
    pg_catalog.now()
  );

  if v_phone is null and v_conversation_key is null and v_legacy_conversation_key is null then
    return false;
  end if;

  insert into public.n8n_chat_conversas (
    numero,
    message,
    time,
    type,
    id_empresa,
    telefone,
    wa_user_id,
    wa_username,
    conversation_key,
    legacy_conversation_key,
    wa_identity_id,
    wa_message_id
  ) values (
    coalesce(v_legacy_conversation_key, v_phone),
    pg_catalog.to_jsonb(v_message.text_body),
    v_message_time,
    'ai',
    v_message.tenant_id,
    v_phone,
    v_lead.wa_user_id,
    v_lead.wa_username,
    v_conversation_key,
    v_legacy_conversation_key,
    v_wa_identity_id,
    v_message.id
  )
  on conflict (wa_message_id) do update
    set numero = excluded.numero,
        message = excluded.message,
        time = excluded.time,
        id_empresa = excluded.id_empresa,
        telefone = excluded.telefone,
        wa_user_id = coalesce(excluded.wa_user_id, public.n8n_chat_conversas.wa_user_id),
        wa_username = coalesce(excluded.wa_username, public.n8n_chat_conversas.wa_username),
        conversation_key = coalesce(excluded.conversation_key, public.n8n_chat_conversas.conversation_key),
        legacy_conversation_key = coalesce(excluded.legacy_conversation_key, public.n8n_chat_conversas.legacy_conversation_key),
        wa_identity_id = coalesce(excluded.wa_identity_id, public.n8n_chat_conversas.wa_identity_id);

  return true;
end;
$$;

revoke all on function public.project_followup_wa_message_to_chat_v2(uuid)
  from public, anon, authenticated;

create or replace function public.project_followup_wa_message_to_chat_trigger_v2()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.project_followup_wa_message_to_chat_v2(new.id);
  return new;
end;
$$;

revoke all on function public.project_followup_wa_message_to_chat_trigger_v2()
  from public, anon, authenticated;

drop trigger if exists trg_project_followup_wa_message_to_chat_v2
  on public.wa_messages;
create trigger trg_project_followup_wa_message_to_chat_v2
after insert or update of status_current, message_id, sent_at, timestamp_meta,
  text_body, tenant_id, crm_entity_id, wa_identity_id, conversation_key,
  legacy_conversation_key
on public.wa_messages
for each row
when (new.direction = 'outbound' and new.raw ->> 'source' = 'followup_v2')
execute function public.project_followup_wa_message_to_chat_trigger_v2();

-- A CRM event must carry the configured stage even when an old dispatch
-- snapshot omitted it. This keeps tag, activity and stage movement consistent.
create or replace function public.resolve_followup_crm_stage_v2()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_type = 'sent' and new.crm_stage_id is null then
    select coalesce(v.id_situacao, s.id_situacao)
      into new.crm_stage_id
    from public.followup_dispatches_v2 d
    join public.followup_steps_v2 s on s.id = d.step_id
    left join public.followup_variants_v2 v on v.id = d.variant_id
    where d.id = new.dispatch_id;
  end if;

  return new;
end;
$$;

revoke all on function public.resolve_followup_crm_stage_v2()
  from public, anon, authenticated;

drop trigger if exists trg_resolve_followup_crm_stage_v2
  on public.followup_crm_events_v2;
create trigger trg_resolve_followup_crm_stage_v2
before insert or update of dispatch_id, event_type, crm_stage_id
on public.followup_crm_events_v2
for each row
execute function public.resolve_followup_crm_stage_v2();

-- Enrich existing transport rows before projecting them.
update public.wa_messages m
set wa_identity_id = coalesce(m.wa_identity_id, l.wa_identity_id),
    conversation_key = coalesce(nullif(m.conversation_key, ''), l.conversation_key),
    legacy_conversation_key = coalesce(nullif(m.legacy_conversation_key, ''), l.legacy_conversation_key),
    updated_at = pg_catalog.now()
from public.lead l
where m.raw ->> 'source' = 'followup_v2'
  and m.tenant_id = l.id_empresa
  and l.id_crm = m.crm_entity_id
  and (
    m.wa_identity_id is null
    or nullif(m.conversation_key, '') is null
    or nullif(m.legacy_conversation_key, '') is null
  );

-- Repair stage ids on events created from snapshots that lost id_situacao.
update public.followup_crm_events_v2 e
set crm_stage_id = coalesce(v.id_situacao, s.id_situacao),
    updated_at = pg_catalog.now()
from public.followup_dispatches_v2 d
join public.followup_steps_v2 s on s.id = d.step_id
left join public.followup_variants_v2 v on v.id = d.variant_id
where e.dispatch_id = d.id
  and e.event_type = 'sent'
  and e.crm_stage_id is null
  and coalesce(v.id_situacao, s.id_situacao) is not null;

-- Move only leads that are still behind the latest successfully processed
-- follow-up. Leads already in a later stage are never regressed.
with latest_target as (
  select distinct on (crm_lead.id)
    crm_lead.id as crm_lead_id,
    target.id as target_stage_id,
    target.ordem as target_order
  from public.followup_crm_events_v2 e
  join public.followup_dispatches_v2 d on d.id = e.dispatch_id
  join public.followup_steps_v2 s on s.id = d.step_id
  left join public.followup_variants_v2 v on v.id = d.variant_id
  join public.lead operational_lead on operational_lead.id = e.lead_id
  join public.crm_leads crm_lead
    on crm_lead.id_empresa = e.id_empresa
   and crm_lead.id::text = operational_lead.id_crm
  join public.crm_stages target
    on target.id = coalesce(v.id_situacao, s.id_situacao)
   and target.id_empresa = e.id_empresa
   and target.ativo = true
  where e.event_type = 'sent'
    and e.status = 'completed'
  order by crm_lead.id, e.created_at desc, e.id desc
), movable as (
  select latest_target.crm_lead_id, latest_target.target_stage_id
  from latest_target
  join public.crm_leads current_lead on current_lead.id = latest_target.crm_lead_id
  left join public.crm_stages current_stage on current_stage.id = current_lead.crm_stage_id
  where current_stage.id is null
     or (
       current_stage.id_funnel = (
         select target_stage.id_funnel
         from public.crm_stages target_stage
         where target_stage.id = latest_target.target_stage_id
       )
       and current_stage.ordem < latest_target.target_order
     )
)
update public.crm_leads crm_lead
set crm_stage_id = movable.target_stage_id,
    updated_at = pg_catalog.now()
from movable
where crm_lead.id = movable.crm_lead_id;

-- Backfill all accepted historical V2 messages without contacting customers.
do $$
declare
  v_message record;
begin
  for v_message in
    select m.id
    from public.wa_messages m
    where m.raw ->> 'source' = 'followup_v2'
      and m.direction = 'outbound'
      and m.status_current in ('accepted', 'sent', 'delivered', 'read')
    order by m.created_at, m.id
  loop
    perform public.project_followup_wa_message_to_chat_v2(v_message.id);
  end loop;
end;
$$;

-- Read delivery state by the durable UUID link. Keep the old fuzzy matcher for
-- manual Hub messages written before wa_message_id existed.
create or replace function public.crm_whatsapp_conversation_messages_v2(
  p_lead_id bigint,
  p_before_id bigint default null,
  p_limit integer default 50
)
returns table (
  id bigint,
  numero text,
  "type" text,
  message jsonb,
  "time" text,
  created_at timestamptz,
  direction text,
  source text,
  transport_message_id text,
  delivery_status text,
  error_code text,
  error_message text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lead public.lead%rowtype;
  v_identity public.wa_contact_identities%rowtype;
  v_role text := public.crm_current_role();
  v_user_empresa bigint := public.crm_current_empresa_id();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_phone text;
  v_company_id text;
begin
  select * into v_lead
  from public.lead l
  where l.id = p_lead_id;

  if not found then
    return;
  end if;

  if v_role is null or (v_role <> 'super_admin' and v_user_empresa is distinct from v_lead.id_empresa) then
    raise exception using errcode = '42501', message = 'Sem permissao para acessar esta conversa';
  end if;

  if v_lead.wa_identity_id is not null then
    select * into v_identity
    from public.wa_contact_identities i
    where i.id = v_lead.wa_identity_id
      and i.id_empresa = v_lead.id_empresa;
  end if;

  v_phone := nullif(
    pg_catalog.regexp_replace(coalesce(v_identity.telefone, v_lead.numero, ''), '[^0-9]', '', 'g'),
    ''
  );
  v_company_id := v_lead.id_empresa::text;

  return query
  select
    chat.id::bigint,
    chat.numero::text,
    chat.type::text,
    chat.message,
    chat.time::text,
    chat.created_at,
    transport.direction::text,
    transport.source::text,
    transport.message_id::text,
    transport.status_current::text,
    transport.error_code::text,
    transport.error_message::text
  from public.n8n_chat_conversas chat
  left join lateral (
    select
      m.direction,
      coalesce(nullif(m.raw ->> 'source', ''), 'whatsapp') as source,
      m.message_id,
      m.status_current,
      m.error_code,
      m.error_message
    from public.wa_messages m
    where m.direction = 'outbound'
      and m.tenant_id = v_lead.id_empresa
      and (
        m.id = chat.wa_message_id
        or (
          chat.wa_message_id is null
          and m.raw ->> 'source' = 'hub_human'
          and (
            (v_lead.wa_identity_id is not null and m.wa_identity_id = v_lead.wa_identity_id)
            or (nullif(v_lead.conversation_key, '') is not null and m.conversation_key = v_lead.conversation_key)
          )
          and m.text_body = case
            when pg_catalog.jsonb_typeof(chat.message) = 'string' then chat.message #>> '{}'
            else coalesce(chat.message ->> 'content', chat.message ->> 'text', chat.message ->> 'message')
          end
          and pg_catalog.abs(
            extract(epoch from (m.sent_at - coalesce(chat.time, chat.created_at)))
          ) <= 5
        )
      )
    order by
      case when m.id = chat.wa_message_id then 0 else 1 end,
      pg_catalog.abs(extract(epoch from (m.sent_at - coalesce(chat.time, chat.created_at)))) nulls last,
      m.created_at desc
    limit 1
  ) transport on chat.type = 'ai'
  where (p_before_id is null or chat.id < p_before_id)
    and (
      (
        chat.id_empresa = v_lead.id_empresa
        and (
          (v_lead.wa_identity_id is not null and chat.wa_identity_id = v_lead.wa_identity_id)
          or (nullif(v_lead.conversation_key, '') is not null and chat.conversation_key = v_lead.conversation_key)
          or (nullif(v_identity.conversation_key, '') is not null and chat.conversation_key = v_identity.conversation_key)
          or (nullif(v_lead.legacy_conversation_key, '') is not null and chat.legacy_conversation_key = v_lead.legacy_conversation_key)
          or (nullif(v_identity.legacy_conversation_key, '') is not null and chat.legacy_conversation_key = v_identity.legacy_conversation_key)
          or (v_phone is not null and pg_catalog.regexp_replace(coalesce(chat.numero, ''), '[^0-9]', '', 'g') in (v_phone, v_phone || v_company_id))
        )
      )
      or (
        chat.id_empresa is null
        and v_phone is not null
        and pg_catalog.regexp_replace(coalesce(chat.numero, ''), '[^0-9]', '', 'g') = v_phone || v_company_id
      )
    )
  order by chat.id desc
  limit v_limit;
end;
$$;

revoke all on function public.crm_whatsapp_conversation_messages_v2(bigint, bigint, integer)
  from public, anon;
grant execute on function public.crm_whatsapp_conversation_messages_v2(bigint, bigint, integer)
  to authenticated;

notify pgrst, 'reload schema';
