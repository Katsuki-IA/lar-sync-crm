-- Homologation only. Synthetic transport, no HTTP dispatch, all changes rolled back.
begin;
insert into private.hub_secretary_endpoints(singleton,base_url) values(true,'https://esdqsdwhhihxmubunwvb.supabase.co/functions/v1');
insert into public.hub_whatsapp_channels(id_empresa,instance,provider,enabled,auto_send,inbound_verified_at) values(5,'task-rehearsal-only','evolution',true,true,now());
do $$ declare a uuid;w uuid;h uuid;begin
 a:=vault.create_secret('fake-api-key-not-a-real-provider');
 w:=vault.create_secret('task-rehearsal-worker-token-not-for-production');
 h:=vault.create_secret('task-rehearsal-webhook-token-not-for-production');
 insert into private.hub_whatsapp_transport values(5,'https://evolution.henaweb.com.br',a,w,h);
end $$;
insert into private.hub_whatsapp_recipients(id_empresa,member_id,phone,enabled) values(5,'4ef61243-2c02-482d-a4a0-56f5289d2d79','5511999999999',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','4ef61243-2c02-482d-a4a0-56f5289d2d79',true);
do $$ declare t jsonb;begin
 t:=public.hub_save_task_v2(5,null,3,'df68f1a1-c962-4400-a902-0537bc9886c3','[ENSAIO] Lembrete','Dados fictícios','alta',now()+interval '10 minutes','4ef61243-2c02-482d-a4a0-56f5289d2d79','pendente',null,gen_random_uuid(),'visita',15);
 perform set_config('test.task_id',t->>'id',true);
end $$;
reset role;
do $$ declare j jsonb;begin
 j:=private.hub_secretary_call('worker','task-rehearsal-worker-token-not-for-production','claim','{}');
 if j is null or j->>'phone'<>'5511999999999' then raise exception 'Claim inesperado';end if;
 perform private.hub_secretary_call('worker','task-rehearsal-worker-token-not-for-production','finish',jsonb_build_object('p_id',j->>'id','p_lease',j->>'lease','p_status','sent','p_provider_id','SIMULATED-NOT-SENT'));
 if private.hub_secretary_call('worker','task-rehearsal-worker-token-not-for-production','claim','{}') is not null then raise exception 'Envio duplicado';end if;
end $$;
set local role authenticated;
do $$ declare t jsonb;begin
 t:=public.hub_save_task_v2(5,current_setting('test.task_id')::uuid,3,'df68f1a1-c962-4400-a902-0537bc9886c3','[ENSAIO] Reagendado',null,'alta',now()+interval '2 hours','4ef61243-2c02-482d-a4a0-56f5289d2d79','pendente',1,null,'ligacao',30);
 perform public.hub_save_task_v2(5,current_setting('test.task_id')::uuid,3,'df68f1a1-c962-4400-a902-0537bc9886c3','[ENSAIO] Reagendado',null,'alta',(t->>'prazo')::timestamptz,'4ef61243-2c02-482d-a4a0-56f5289d2d79','concluida',2,null,'ligacao',30);
end $$;
reset role;
select jsonb_build_object('status',t.status,'type',t.tipo,'reminder',t.reminder_minutes,'outbox_status',r.status,'revision',t.revision) as verified from public.crm_lead_tasks t join private.hub_task_reminders r on r.task_id=t.id where t.id=current_setting('test.task_id')::uuid;
rollback;
