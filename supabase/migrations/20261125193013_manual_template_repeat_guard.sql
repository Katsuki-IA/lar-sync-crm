-- Every manual send reserves a delivery before contacting WhatsApp. Serialize
-- reservations with different request IDs for the same lead and template.
create index hub_manual_template_by_lead
  on private.hub_conversation_deliveries (id_empresa, lead_id, (request_body->>'templateName'))
  where request_body->>'action' = 'send_template';

create function private.guard_manual_template_repeat()
returns trigger language plpgsql set search_path = '' as $$
declare
  template_name text := new.request_body->>'templateName';
  accepted_until timestamptz;
  pending boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    jsonb_build_array(new.id_empresa, new.lead_id, template_name)::text, 0));

  -- Let the existing ON CONFLICT path return the original request's result.
  if exists (select 1 from private.hub_conversation_deliveries
             where id_empresa = new.id_empresa and request_id = new.request_id) then
    return new;
  end if;

  select max(coalesce((d.receipt #>> '{transport,sent_at}')::timestamptz,
                      d.completed_at, d.created_at)) filter (where d.state in ('accepted','completed'))
           + interval '24 hours',
         bool_or(d.state = 'sending' and d.created_at > clock_timestamp() - interval '24 hours')
    into accepted_until, pending
    from private.hub_conversation_deliveries d
   where d.id_empresa = new.id_empresa and d.lead_id = new.lead_id
     and d.request_body->>'action' = 'send_template'
     and d.request_body->>'templateName' = template_name;

  if accepted_until > clock_timestamp() then
    raise exception 'Este template já foi enviado para este lead. Você poderá reenviá-lo em % (Brasília).',
      to_char(accepted_until at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI:SS')
      using errcode = 'PT429';
  end if;
  if pending then
    raise exception 'Já existe um envio deste template para este lead aguardando confirmação.'
      using errcode = 'PT409';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_manual_template_repeat() from public, anon, authenticated;
create trigger guard_manual_template_repeat before insert on private.hub_conversation_deliveries
for each row when (new.request_body->>'action' = 'send_template')
execute function private.guard_manual_template_repeat();

-- Only release an unaccepted reservation after an explicit provider rejection.
create function public.hub_release_rejected_template(p_id uuid, p_token uuid)
returns void language sql security definer set search_path = '' as $$
  delete from private.hub_conversation_deliveries
   where id = p_id and claim_token = p_token and state = 'sending' and receipt is null
     and request_body->>'action' = 'send_template';
$$;
revoke all on function public.hub_release_rejected_template(uuid,uuid) from public, anon, authenticated;
grant execute on function public.hub_release_rejected_template(uuid,uuid) to service_role;
