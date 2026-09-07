-- Backend da Central de Conversas WhatsApp.
-- Mantem o historico em n8n_chat_conversas nesta etapa, mas remove a
-- dependencia de crm_leads para permitir conversas de qualquer empresa.

alter table public.lead
  add column if not exists wa_conversation_assigned_to uuid
    references public.crm_users(id) on delete set null,
  add column if not exists wa_conversation_assigned_at timestamptz;

comment on column public.lead.wa_conversation_assigned_to is
  'Usuario do painel que assumiu a conversa WhatsApp. Nao altera o responsavel comercial do lead.';
comment on column public.lead.wa_conversation_assigned_at is
  'Instante em que o atendimento humano da conversa foi assumido no painel.';

create index if not exists lead_whatsapp_inbox_empresa_updated_idx
  on public.lead (id_empresa, updated_at desc, id desc);

create index if not exists lead_whatsapp_human_queue_idx
  on public.lead (id_empresa, atendimento_humano, wa_conversation_assigned_to, updated_at desc)
  where atendimento_humano = true;

create or replace function public.crm_whatsapp_clear_assignment_when_released()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not coalesce(new.atendimento_humano, false) then
    new.wa_conversation_assigned_to := null;
    new.wa_conversation_assigned_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_whatsapp_assignment_when_released on public.lead;
create trigger clear_whatsapp_assignment_when_released
before insert or update of atendimento_humano on public.lead
for each row
execute function public.crm_whatsapp_clear_assignment_when_released();

revoke all on function public.crm_whatsapp_clear_assignment_when_released() from public;

create or replace function public.crm_whatsapp_list_conversations(
  p_id_empresa bigint,
  p_search text default null,
  p_only_human boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  lead_id bigint,
  id_empresa bigint,
  wa_identity_id uuid,
  conversation_key text,
  legacy_conversation_key text,
  nome text,
  telefone text,
  wa_user_id text,
  wa_username text,
  display_name text,
  last_message text,
  last_message_at timestamptz,
  atendimento_humano boolean,
  atendimento_humano_desde timestamptz,
  assigned_to uuid,
  assigned_name text,
  assigned_at timestamptz,
  status text,
  id_crm text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.crm_current_role();
  v_user_empresa bigint := public.crm_current_empresa_id();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(pg_catalog.btrim(coalesce(p_search, '')), '');
begin
  if p_id_empresa is null then
    raise exception using errcode = '22023', message = 'id_empresa obrigatorio';
  end if;

  if v_role is null or (v_role <> 'super_admin' and v_user_empresa is distinct from p_id_empresa) then
    raise exception using errcode = '42501', message = 'Sem permissao para acessar as conversas desta empresa';
  end if;

  return query
  with ranked as (
    select
      l.*,
      i.username as identity_username,
      i.display_name as identity_display_name,
      i.last_seen_at as identity_last_seen_at,
      row_number() over (
        partition by coalesce(
          l.wa_identity_id::text,
          nullif(l.conversation_key, ''),
          nullif(l.legacy_conversation_key, ''),
          nullif(pg_catalog.regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g'), ''),
          'lead:' || l.id::text
        )
        order by coalesce(l.updated_at, l.created_at) desc nulls last, l.id desc
      ) as conversation_rank
    from public.lead l
    left join public.wa_contact_identities i
      on i.id = l.wa_identity_id
     and i.id_empresa = l.id_empresa
    where l.id_empresa = p_id_empresa
      and (not coalesce(p_only_human, false) or coalesce(l.atendimento_humano, false))
      and (
        v_search is null
        or coalesce(l.nome, '') ilike '%' || v_search || '%'
        or coalesce(l.numero, '') ilike '%' || v_search || '%'
        or coalesce(l.wa_user_id, '') ilike '%' || v_search || '%'
        or coalesce(l.wa_username, '') ilike '%' || v_search || '%'
        or coalesce(i.username, '') ilike '%' || v_search || '%'
        or coalesce(i.display_name, '') ilike '%' || v_search || '%'
      )
  ), conversations as (
    select r.*
    from ranked r
    where r.conversation_rank = 1
  )
  select
    c.id,
    c.id_empresa,
    c.wa_identity_id,
    c.conversation_key,
    c.legacy_conversation_key,
    coalesce(nullif(c.nome, ''), nullif(c.identity_display_name, ''), nullif(c.identity_username, ''), 'Contato WhatsApp')::text,
    nullif(c.numero, '')::text,
    c.wa_user_id,
    coalesce(nullif(c.wa_username, ''), nullif(c.identity_username, '')),
    c.identity_display_name,
    case
      when c.ult_message is not null and c.ult_message !~ '^[0-9]+([.][0-9]+)?$' then c.ult_message
      when c.last_mesage is not null and c.last_mesage !~ '^[0-9]+([.][0-9]+)?$' then c.last_mesage
      else null
    end,
    greatest(
      coalesce(c.identity_last_seen_at, '-infinity'::timestamptz),
      coalesce(c.updated_at, '-infinity'::timestamptz),
      coalesce(c.created_at, '-infinity'::timestamptz)
    ),
    coalesce(c.atendimento_humano, false),
    c.atendimento_humano_desde,
    c.wa_conversation_assigned_to,
    u.nome::text,
    c.wa_conversation_assigned_at,
    c.status,
    c.id_crm::text,
    count(*) over ()
  from conversations c
  left join public.crm_users u
    on u.id = c.wa_conversation_assigned_to
   and u.id_empresa = c.id_empresa
  order by
    greatest(
      coalesce(c.identity_last_seen_at, '-infinity'::timestamptz),
      coalesce(c.updated_at, '-infinity'::timestamptz),
      coalesce(c.created_at, '-infinity'::timestamptz)
    ) desc,
    c.id desc
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.crm_whatsapp_conversation_messages(
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
  created_at timestamptz
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

  v_phone := nullif(pg_catalog.regexp_replace(coalesce(v_lead.numero, v_identity.telefone, ''), '[^0-9]', '', 'g'), '');
  v_company_id := v_lead.id_empresa::text;

  return query
  select
    chat.id::bigint,
    chat.numero::text,
    chat.type::text,
    chat.message,
    chat.time::text,
    chat.created_at
  from public.n8n_chat_conversas chat
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

create or replace function public.crm_whatsapp_set_conversation_attendance(
  p_lead_id bigint,
  p_enabled boolean,
  p_force boolean default false
)
returns table (
  lead_id bigint,
  id_empresa bigint,
  atendimento_humano boolean,
  atendimento_humano_desde timestamptz,
  assigned_to uuid,
  assigned_name text,
  assigned_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.lead%rowtype;
  v_role text := public.crm_current_role();
  v_user_empresa bigint := public.crm_current_empresa_id();
  v_user_id uuid := public.crm_current_user_id();
begin
  if v_role is null or v_user_id is null then
    raise exception using errcode = '42501', message = 'Usuario autenticado do CRM nao encontrado';
  end if;

  select * into v_lead
  from public.lead l
  where l.id = p_lead_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Conversa nao encontrada';
  end if;

  if v_role <> 'super_admin' and v_user_empresa is distinct from v_lead.id_empresa then
    raise exception using errcode = '42501', message = 'Sem permissao para alterar esta conversa';
  end if;

  if p_enabled then
    if v_lead.wa_conversation_assigned_to is not null
       and v_lead.wa_conversation_assigned_to <> v_user_id
       and not (coalesce(p_force, false) and v_role in ('manager', 'super_admin')) then
      raise exception using errcode = '55000', message = 'Esta conversa ja foi assumida por outro atendente';
    end if;

    update public.lead l
    set atendimento_humano = true,
        atendimento_humano_desde = case
          when coalesce(l.atendimento_humano, false) then coalesce(l.atendimento_humano_desde, pg_catalog.now())
          else pg_catalog.now()
        end,
        wa_conversation_assigned_to = v_user_id,
        wa_conversation_assigned_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where l.id = p_lead_id
    returning l.* into v_lead;
  else
    if v_lead.wa_conversation_assigned_to is distinct from v_user_id
       and v_role not in ('manager', 'super_admin') then
      raise exception using errcode = '42501', message = 'Somente o atendente responsavel ou um gestor pode devolver esta conversa para a IA';
    end if;

    update public.lead l
    set atendimento_humano = false,
        atendimento_humano_desde = null,
        wa_conversation_assigned_to = null,
        wa_conversation_assigned_at = null,
        updated_at = pg_catalog.now()
    where l.id = p_lead_id
    returning l.* into v_lead;
  end if;

  return query
  select
    v_lead.id,
    v_lead.id_empresa,
    coalesce(v_lead.atendimento_humano, false),
    v_lead.atendimento_humano_desde,
    v_lead.wa_conversation_assigned_to,
    u.nome::text,
    v_lead.wa_conversation_assigned_at
  from public.crm_users u
  where u.id = v_lead.wa_conversation_assigned_to
  union all
  select
    v_lead.id,
    v_lead.id_empresa,
    coalesce(v_lead.atendimento_humano, false),
    v_lead.atendimento_humano_desde,
    null::uuid,
    null::text,
    v_lead.wa_conversation_assigned_at
  where v_lead.wa_conversation_assigned_to is null;
end;
$$;

revoke all on function public.crm_whatsapp_list_conversations(bigint, text, boolean, integer, integer)
  from public, anon;
grant execute on function public.crm_whatsapp_list_conversations(bigint, text, boolean, integer, integer)
  to authenticated;

revoke all on function public.crm_whatsapp_conversation_messages(bigint, bigint, integer)
  from public, anon;
grant execute on function public.crm_whatsapp_conversation_messages(bigint, bigint, integer)
  to authenticated;

revoke all on function public.crm_whatsapp_set_conversation_attendance(bigint, boolean, boolean)
  from public, anon;
grant execute on function public.crm_whatsapp_set_conversation_attendance(bigint, boolean, boolean)
  to authenticated;

notify pgrst, 'reload schema';
