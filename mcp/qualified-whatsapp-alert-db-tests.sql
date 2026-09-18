-- Entire script must execute in BEGIN/ROLLBACK. No fixtures are committed.
do $$
declare v_job uuid; v_job2 uuid; v_id uuid; v_token uuid; v_count int; v_ok boolean;
begin
  assert not exists(select 1 from public.crm_leads where id=-91820263),'fixture ID already used';
  insert into public.crm_leads(id,id_empresa,nome,telefone,qualificado)
    values(-91820263,25,'Synthetic alert rollback test','5500000000000',0);
  delete from public.crm_external_dispatch_queue where crm_lead_id=-91820263;
  update public.empresa_dados set id_group='120363000000000000@g.us' where id=25;
  insert into public.crm_external_dispatch_queue(id_empresa,crm_lead_id,trigger_type,scheduled_at,payload)
    values(25,-91820263,'qualified',now(),'{"enforceQualificationRule":true}') returning id into v_job;
  assert not exists(select 1 from private.qualified_whatsapp_alerts where crm_lead_id=-91820263),'pending CRM must not notify';
  update public.crm_external_dispatch_queue set status='failed' where id=v_job;
  assert not exists(select 1 from private.qualified_whatsapp_alerts where crm_lead_id=-91820263),'failed CRM must not notify';
  update public.crm_external_dispatch_queue set status='sent' where id=v_job;
  select count(*),min(id::text)::uuid into v_count,v_id from private.qualified_whatsapp_alerts where crm_lead_id=-91820263;
  assert v_count=1,'successful dispatch must enqueue';
  update public.crm_external_dispatch_queue set status='sent' where id=v_job;
  insert into public.crm_external_dispatch_queue(id_empresa,crm_lead_id,trigger_type,scheduled_at,status,payload)
    values(25,-91820263,'qualified',now(),'processing','{"enforceQualificationRule":true}') returning id into v_job2;
  update public.crm_external_dispatch_queue set status='sent' where id=v_job2;
  assert (select count(*)=1 from private.qualified_whatsapp_alerts where crm_lead_id=-91820263),'duplicate dispatch must not duplicate alert';
  -- Avoid claiming other production alerts in this rollback-only test.
  update private.qualified_whatsapp_alerts set status='skipped' where id<>v_id and status='pending';
  select claim_token into v_token from private.claim_qualified_whatsapp_alerts(10) where alert_id=v_id;
  assert v_token is not null,'claim produced token';
  assert not exists(select 1 from private.claim_qualified_whatsapp_alerts(10) where alert_id=v_id),'concurrent worker cannot reclaim';
  v_ok:=private.finish_qualified_whatsapp_alert(v_id,gen_random_uuid(),'sent','synthetic-receipt',null);
  assert not v_ok,'wrong lock token cannot acknowledge';
  v_ok:=private.finish_qualified_whatsapp_alert(v_id,v_token,'sent','synthetic-receipt',null);
  assert v_ok,'valid acknowledgement';
  assert not private.finish_qualified_whatsapp_alert(v_id,v_token,'sent','synthetic-receipt',null),'ack is idempotent';
  update private.qualified_whatsapp_alerts set status='processing',locked_at=now()-interval '11 minutes' where id=v_id;
  perform * from private.claim_qualified_whatsapp_alerts(10);
  assert (select status='uncertain' from private.qualified_whatsapp_alerts where id=v_id),'stale claim must not resend blindly';
  update private.qualified_whatsapp_alerts set status='pending' where id=v_id;
  update public.empresa_dados set id_group=null where id=25;
  assert not exists(select 1 from private.claim_qualified_whatsapp_alerts(10) where alert_id=v_id),'missing group never sends';
  assert (select status='skipped' from private.qualified_whatsapp_alerts where id=v_id),'missing group is recorded';
  delete from private.qualified_whatsapp_alerts where id=v_id;
  update public.crm_external_dispatch_queue set status='processing',payload='{}' where id=v_job;
  update public.crm_external_dispatch_queue set status='sent' where id=v_job;
  assert not exists(select 1 from private.qualified_whatsapp_alerts where crm_lead_id=-91820263),'followup/visit must not trigger qualified alert';
end;
$$;
select 'qualified_whatsapp_alert_db_tests_passed' as result;
