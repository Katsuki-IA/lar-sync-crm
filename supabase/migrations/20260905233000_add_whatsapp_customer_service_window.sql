-- Expõe a janela de atendimento livre do WhatsApp por conversa.
-- A janela permanece aberta por 24 horas após a última mensagem inbound.

create or replace function public.crm_whatsapp_conversation_windows(
  p_id_empresa bigint,
  p_lead_ids bigint[] default null
)
returns table (
  lead_id bigint,
  last_inbound_at timestamptz,
  window_expires_at timestamptz,
  window_open boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.crm_current_role();
  v_user_empresa bigint := public.crm_current_empresa_id();
  v_jwt_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if p_id_empresa is null then
    raise exception using errcode = '22023', message = 'id_empresa obrigatorio';
  end if;

  if v_jwt_role <> 'service_role'
     and (v_role is null or (v_role <> 'super_admin' and v_user_empresa is distinct from p_id_empresa)) then
    raise exception using errcode = '42501', message = 'Sem permissao para consultar a janela destas conversas';
  end if;

  return query
  select
    l.id,
    inbound.last_inbound_at,
    inbound.last_inbound_at + interval '24 hours',
    coalesce(inbound.last_inbound_at > pg_catalog.now() - interval '24 hours', false)
  from public.lead l
  left join lateral (
    select max(coalesce(chat.time, chat.created_at)) as last_inbound_at
    from public.n8n_chat_conversas chat
    where chat.type = 'human'
      and (chat.id_empresa = l.id_empresa or chat.id_empresa is null)
      and (
        (l.wa_identity_id is not null and chat.wa_identity_id = l.wa_identity_id)
        or (
          nullif(l.conversation_key, '') is not null
          and chat.conversation_key = l.conversation_key
        )
        or (
          nullif(l.legacy_conversation_key, '') is not null
          and chat.legacy_conversation_key = l.legacy_conversation_key
        )
        or (
          nullif(l.wa_user_id, '') is not null
          and chat.wa_user_id = l.wa_user_id
        )
        or (
          nullif(pg_catalog.regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g'), '') is not null
          and pg_catalog.regexp_replace(coalesce(chat.telefone, chat.numero, ''), '[^0-9]', '', 'g') in (
            pg_catalog.regexp_replace(l.numero, '[^0-9]', '', 'g'),
            pg_catalog.regexp_replace(l.numero, '[^0-9]', '', 'g') || l.id_empresa::text
          )
        )
      )
  ) inbound on true
  where l.id_empresa = p_id_empresa
    and (p_lead_ids is null or l.id = any(p_lead_ids));
end;
$$;

comment on function public.crm_whatsapp_conversation_windows(bigint, bigint[]) is
  'Retorna a ultima mensagem inbound e a janela de 24 horas das conversas solicitadas.';

revoke all on function public.crm_whatsapp_conversation_windows(bigint, bigint[])
  from public, anon;
grant execute on function public.crm_whatsapp_conversation_windows(bigint, bigint[])
  to authenticated, service_role;
