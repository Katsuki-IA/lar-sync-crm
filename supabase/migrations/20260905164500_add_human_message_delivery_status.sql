-- Exposes Meta delivery status only for messages sent manually from the Hub.
-- The existing history continues to come from n8n_chat_conversas.

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
    case when transport.message_id is not null then 'outbound'::text else null::text end,
    case when transport.message_id is not null then 'hub_human'::text else null::text end,
    transport.message_id::text,
    transport.status_current::text,
    transport.error_code::text,
    transport.error_message::text
  from public.n8n_chat_conversas chat
  left join lateral (
    select
      m.message_id,
      m.status_current,
      m.error_code,
      m.error_message
    from public.wa_messages m
    where m.direction = 'outbound'
      and m.tenant_id = v_lead.id_empresa
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
    order by pg_catalog.abs(
      extract(epoch from (m.sent_at - coalesce(chat.time, chat.created_at)))
    ), m.created_at desc
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
