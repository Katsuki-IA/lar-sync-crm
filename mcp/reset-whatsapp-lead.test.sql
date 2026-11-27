begin;
do $test$
declare
  v_phone text := '000' || txid_current()::text;
  v_key text := v_phone || '22';
  v_lead bigint;
  v_message uuid;
  v_other uuid;
  v_dispatch bigint;
  v_attempt bigint;
  r record;
begin
  if exists (select 1 from public.lead where numero = v_phone) then
    raise exception 'Fixture phone collision';
  end if;
  insert into public.lead(id_empresa,nome,numero) values(22,'Reset regression fixture',v_phone) returning id into v_lead;
  insert into public.wa_messages(phone_number_id,direction,tenant_id,conversation_key,client_message_id)
    values ('reset-test','outbound',22,v_key,v_key) returning id into v_message;
  insert into public.wa_messages(phone_number_id,direction,tenant_id,conversation_key,client_message_id)
    values ('reset-test','outbound',41,v_key,v_key || '-other') returning id into v_other;
  insert into public.followup_dispatches_v2(sequence_id,step_id,variant_id,lead_id,id_empresa,conversation_context,scheduled_at,idempotency_key)
    select sequence_id,step_id,variant_id,v_lead,22,'no_reply',now(),'reset-test-' || v_key
    from public.followup_dispatches_v2 where id_empresa=22 limit 1 returning id into strict v_dispatch;
  insert into public.followup_attempts_v2(dispatch_id,attempt_number,wa_message_id)
    values (v_dispatch,1,v_message) returning id into v_attempt;
  insert into public.followup_crm_events_v2(id_empresa,lead_id,dispatch_id,attempt_id,wa_message_id,event_type,subject,message_body)
    values (22,v_lead,v_dispatch,v_attempt,v_message,'sent','fixture','fixture');
  select * into strict r from private.reset_whatsapp_lead(22,v_phone,null);
  if r.eventos_followup_excluidos <> 1 or r.mensagens_whatsapp_excluidas <> 1 or r.leads_excluidos <> 1
     or not exists (select 1 from public.wa_messages where id = v_other) then
    raise exception 'Unexpected reset result: %', row_to_json(r);
  end if;
  select * into strict r from private.reset_whatsapp_lead(22,v_phone,null);
  if r.leads_excluidos <> 0 or r.mensagens_whatsapp_excluidas <> 0 then
    raise exception 'Repeated reset was not empty';
  end if;
end;
$test$;
rollback;
