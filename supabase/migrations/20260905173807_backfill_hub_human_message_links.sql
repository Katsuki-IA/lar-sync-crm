-- Link manual Hub history rows to their canonical WhatsApp transport records.
-- New sends write this relation directly in whatsapp-conversation-send.

with ranked_matches as (
  select
    chat.id as chat_id,
    transport.id as wa_message_id,
    row_number() over (
      partition by chat.id
      order by
        pg_catalog.abs(
          extract(epoch from (transport.sent_at - coalesce(chat.time, chat.created_at)))
        ),
        transport.created_at desc,
        transport.id
    ) as match_rank
  from public.n8n_chat_conversas chat
  join public.wa_messages transport
    on transport.direction = 'outbound'
   and transport.tenant_id = chat.id_empresa
   and transport.raw ->> 'source' = 'hub_human'
   and transport.text_body = case
     when pg_catalog.jsonb_typeof(chat.message) = 'string' then chat.message #>> '{}'
     else coalesce(chat.message ->> 'content', chat.message ->> 'text', chat.message ->> 'message')
   end
   and pg_catalog.abs(
     extract(epoch from (transport.sent_at - coalesce(chat.time, chat.created_at)))
   ) <= 5
   and (
     (
       chat.wa_identity_id is not null
       and transport.wa_identity_id = chat.wa_identity_id
     )
     or (
       nullif(chat.conversation_key, '') is not null
       and transport.conversation_key = chat.conversation_key
     )
     or (
       nullif(chat.legacy_conversation_key, '') is not null
       and transport.legacy_conversation_key = chat.legacy_conversation_key
     )
     or (
       nullif(
         pg_catalog.regexp_replace(coalesce(chat.telefone, chat.numero, ''), '[^0-9]', '', 'g'),
         ''
       ) = nullif(
         pg_catalog.regexp_replace(
           coalesce(transport.raw #>> '{request,to}', transport.to_wa_id, ''),
           '[^0-9]',
           '',
           'g'
         ),
         ''
       )
     )
   )
  where chat.wa_message_id is null
    and chat.type = 'ai'
)
update public.n8n_chat_conversas chat
set wa_message_id = matches.wa_message_id
from ranked_matches matches
where matches.chat_id = chat.id
  and matches.match_rank = 1
  and chat.wa_message_id is null;
