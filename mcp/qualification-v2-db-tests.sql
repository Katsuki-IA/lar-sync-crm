-- Run inside BEGIN/ROLLBACK; fixtures and settings are never committed.
do $$
declare v_job uuid; v_result jsonb; v_tag bigint; v_count int;
begin
  if exists(select 1 from public.crm_leads where id=-91820261) or exists(select 1 from public.lead where id=-91820262) then
    raise exception 'Test fixture IDs unavailable';
  end if;
  insert into public.crm_lead_dispatch_settings(id_empresa,send_when_qualified,cv_distribution_queue_qualified_id)
    values(25,false,'777') on conflict(id_empresa) do update set send_when_qualified=false,cv_distribution_queue_qualified_id='777';
  insert into public.lead(id,id_empresa,nome,numero,qualificado,interesse_comercial,qualificacao_message_id)
    values(-91820262,25,'Qualification rollback test','5500000000000',0,true,'test-v2');
  insert into public.crm_leads(id,id_empresa,nome,telefone,lead_id,qualificado)
    values(-91820261,25,'Qualification rollback test','5500000000000',-91820262,0);
  -- Some existing insert triggers may schedule unrelated first-contact work;
  -- none can observe these uncommitted fixtures.
  delete from public.crm_external_dispatch_queue where crm_lead_id=-91820261;
  v_result:=public.crm_sync_lead_qualification(25,-91820262,'wrong-message');
  assert v_result->>'lead_hub_atualizado'='false','stale model result must not sync';
  v_result:=public.crm_sync_lead_qualification(25,-91820262,'test-v2');
  assert v_result->>'tag_aplicada'='Interesse comercial','pending interest tag';
  assert not exists(select 1 from public.crm_external_dispatch_queue where crm_lead_id=-91820261),'pending must not dispatch';
  update public.lead set qualificado=1 where id=-91820262;
  perform public.crm_sync_lead_qualification(25,-91820262,'test-v2');
  assert not exists(select 1 from public.crm_external_dispatch_queue where crm_lead_id=-91820261),'disabled switch';
  update public.crm_lead_dispatch_settings set send_when_qualified=true where id_empresa=25;
  assert not exists(select 1 from public.crm_external_dispatch_queue where crm_lead_id=-91820261),'no historical backfill on enable';
  update public.lead set qualificado=0 where id=-91820262;
  perform public.crm_sync_lead_qualification(25,-91820262,'test-v2');
  update public.lead set qualificado=1 where id=-91820262;
  perform public.crm_sync_lead_qualification(25,-91820262,'test-v2');
  perform public.crm_sync_lead_qualification(25,-91820262,'test-v2');
  select count(*),min(id::text)::uuid into v_count,v_job from public.crm_external_dispatch_queue where crm_lead_id=-91820261;
  assert v_count=1,'field and tag events deduplicate';
  update public.crm_leads set qualification_dispatch_started_at=now()-interval '24 hours' where id=-91820261;
  update public.crm_external_dispatch_queue set status='processing' where id=v_job;
  v_result:=public.crm_prepare_qualified_dispatch(v_job);
  assert v_result->>'action'='send','qualified sends';
  assert v_result->'payload'->>'cvDistributionQueueId'='777','qualified CV queue';
  update public.lead set qualificado=2 where id=-91820262;
  perform public.crm_sync_lead_qualification(25,-91820262,'test-v2');
  assert (select not lead_quente and qualificado=2 from public.crm_leads where id=-91820261),'reclassification clears hot';
  assert not exists(select 1 from public.crm_lead_tags lt join public.crm_tags t on t.id=lt.tag_id
    where lt.lead_id=-91820261 and t.nome in ('Qualificado','Interesse comercial')),'mutually exclusive tags';
  v_result:=public.crm_prepare_qualified_dispatch(v_job);
  assert v_result->>'action'='cancelled','withdrawn qualification cancels before dispatch';
  -- Preserve an existing follow-up schedule when qualification is withdrawn.
  perform public.crm_enqueue_external_dispatch(25,-91820261,now()+interval '1 day','followup','fup4',jsonb_build_object('leadId',-91820261,'idEmpresa',25));
  update public.lead set qualificado=1 where id=-91820262;
  perform public.crm_sync_lead_qualification(25,-91820262,'test-v2');
  select id into v_job from public.crm_external_dispatch_queue where crm_lead_id=-91820261 and status='pending';
  assert (select payload ? 'qualificationFallback' from public.crm_external_dispatch_queue where id=v_job),'followup saved';
  perform public.crm_enqueue_external_dispatch(25,-91820261,now()+interval '2 days','followup','fup4-later',jsonb_build_object('leadId',-91820261,'idEmpresa',25));
  assert (select payload->>'enforceQualificationRule'='true' from public.crm_external_dispatch_queue where id=v_job),'later followup preserves qualification priority';
  update public.crm_lead_dispatch_settings set send_when_qualified=false where id_empresa=25;
  update public.crm_external_dispatch_queue set status='processing' where id=v_job;
  v_result:=public.crm_prepare_qualified_dispatch(v_job);
  assert v_result->>'action'='deferred','disabled switch restores followup';
  assert (select status='pending' and trigger_reference='fup4-later' and scheduled_at>now()+interval '1 day' from public.crm_external_dispatch_queue where id=v_job),'original rule retained';
  -- Already exported leads do not create another qualification job.
  update public.crm_external_dispatch_queue set status='cancelled' where id=v_job;
  insert into public.crm_lead_activities(lead_id,crm_user_id,tipo,descricao,metadata)
    values(-91820261,public.crm_get_or_create_ai_user(25),'crm_export','Rollback test',jsonb_build_object('event','external_crm_sent'));
  update public.crm_lead_dispatch_settings set send_when_qualified=true where id_empresa=25;
  update public.crm_leads set qualificado=0 where id=-91820261;
  update public.crm_leads set qualificado=1 where id=-91820261;
  assert not exists(select 1 from public.crm_external_dispatch_queue where crm_lead_id=-91820261 and status in ('pending','processing')),'already sent skip';
end;
$$;
select 'qualification_v2_db_tests_passed' as result;
