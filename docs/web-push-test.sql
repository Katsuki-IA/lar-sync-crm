begin;
do $test$
declare ana uuid; other uuid; n uuid:=gen_random_uuid(); payload jsonb;sid uuid;
begin
 select id into strict ana from public.crm_users where id='36ac39f5-27e6-45aa-a28c-42de74836395' and active;
 select id into strict other from public.crm_users where active and role='agent' and id_empresa not in (35,36) limit 1;
 insert into private.hub_push_subscriptions(user_id,endpoint,p256dh,auth_key,origin,created_at)
 values(ana,'https://fcm.googleapis.com/fcm/send/test-ana','test','test','https://hub.katsuki.com.br',now()-interval '1 day') returning id into sid;
 insert into private.hub_push_subscriptions(user_id,endpoint,p256dh,auth_key,origin,created_at)
 values(other,'https://fcm.googleapis.com/fcm/send/test-other','test','test','https://hub.katsuki.com.br',now()-interval '1 day');
 insert into public.crm_notifications(id,titulo,mensagem,all_empresas,created_by) values(n,'Test','Test',true,ana);
 payload:=public.hub_push_service('claim');
 if jsonb_array_length(payload->'jobs')<2 then raise exception 'Missing notifications';end if;
 if exists(select 1 from private.hub_push_deliveries where user_id=other and event_key like 'prospect:%') then raise exception 'Cross-company leak';end if;
 if (select count(*) from private.hub_push_deliveries where event_key='notice:'||n)<>2 then raise exception 'Broadcast missing';end if;
 payload:=public.hub_push_service('claim');
 if jsonb_array_length(payload->'jobs')<>0 then raise exception 'Concurrent claim duplicate';end if;
 update private.hub_push_subscriptions set enabled=false where id=sid;
 perform public.hub_push_service('claim');
 if exists(select 1 from private.hub_push_deliveries where subscription_id=sid and state in ('pending','sending')) then raise exception 'Disabled device still queued';end if;
 if has_function_privilege('authenticated','public.hub_push_service(text,jsonb)','execute') or has_function_privilege('anon','public.hub_push_service(text,jsonb)','execute') then raise exception 'Public service access';end if;
end $test$;
rollback;
