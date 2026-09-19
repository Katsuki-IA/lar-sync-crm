-- Execute within BEGIN/ROLLBACK. No CRM calls or messages are made.
do $$
declare j uuid; r jsonb; started timestamptz; tag bigint;
begin
  assert not exists(select 1 from public.crm_leads where id=-91820264),'fixture ID in use';
  insert into public.crm_lead_dispatch_settings(id_empresa,send_when_qualified)
    values(25,true) on conflict(id_empresa) do update set send_when_qualified=true;
  insert into public.crm_leads(id,id_empresa,nome,telefone,qualificado)
    values(-91820264,25,'24h rollback test','5500000000000',0);
  delete from public.crm_external_dispatch_queue where crm_lead_id=-91820264;
  update public.crm_leads set qualificado=1 where id=-91820264;
  select id into j from public.crm_external_dispatch_queue where crm_lead_id=-91820264 and status='pending';
  assert j is not null,'qualification creates delayed job';
  assert (select scheduled_at=now()+interval '24 hours' from public.crm_external_dispatch_queue where id=j),'24h from qualification';
  update public.crm_external_dispatch_queue set status='processing',attempts=1 where id=j;
  r:=public.crm_prepare_qualified_dispatch(j);
  assert r->>'reason'='qualification_24h_window','early claim must wait';
  assert (select status='pending' and attempts=0 from public.crm_external_dispatch_queue where id=j),'waiting does not consume retry';
  assert not exists(select 1 from private.qualified_whatsapp_alerts where crm_lead_id=-91820264),'no WhatsApp before dispatch';
  -- Existing conversations and duplicate tagging must not extend the same window.
  update public.crm_leads set qualification_dispatch_started_at=now()-interval '12 hours' where id=-91820264;
  update public.crm_leads set qualificado=1 where id=-91820264;
  assert (select qualification_dispatch_started_at=now()-interval '12 hours' from public.crm_leads where id=-91820264),'same status preserves start';
  update public.crm_leads set qualificado=2 where id=-91820264;
  assert (select qualification_dispatch_started_at is null from public.crm_leads where id=-91820264),'loss clears window';
  update public.crm_external_dispatch_queue set status='processing' where id=j;
  r:=public.crm_prepare_qualified_dispatch(j);
  assert r->>'action'='cancelled','disqualified does not send';
  update public.crm_leads set qualificado=1 where id=-91820264;
  select id into j from public.crm_external_dispatch_queue where crm_lead_id=-91820264 and status='pending';
  assert (select scheduled_at=now()+interval '24 hours' from public.crm_external_dispatch_queue where id=j),'requalification restarts 24h';
  update public.crm_leads set qualification_dispatch_started_at=now()-interval '24 hours' where id=-91820264;
  update public.crm_external_dispatch_queue set status='processing' where id=j;
  r:=public.crm_prepare_qualified_dispatch(j);
  assert r->>'action'='send','qualified at 24h may dispatch';
  update public.crm_external_dispatch_queue set status='sent' where id=j;
  assert (select count(*)=1 from private.qualified_whatsapp_alerts where crm_lead_id=-91820264),'WhatsApp queued only after CRM success, not another 24h';
  -- Requalification while original job is still pending must also restart.
  delete from private.qualified_whatsapp_alerts where crm_lead_id=-91820264;
  delete from public.crm_external_dispatch_queue where crm_lead_id=-91820264;
  update public.crm_leads set qualificado=0 where id=-91820264;
  update public.crm_leads set qualificado=1 where id=-91820264;
  select id into j from public.crm_external_dispatch_queue where crm_lead_id=-91820264 and status='pending';
  update public.crm_external_dispatch_queue set scheduled_at=now()+interval '1 hour' where id=j;
  update public.crm_leads set qualificado=0 where id=-91820264;
  update public.crm_leads set qualificado=1 where id=-91820264;
  assert (select scheduled_at=now()+interval '24 hours' from public.crm_external_dispatch_queue where id=j),'existing pending job gets new window';
  -- Tag-only qualification uses the same timer; removing tag ends that timer.
  update public.crm_leads set qualificado=0 where id=-91820264;
  select id into tag from public.crm_tags where id_empresa=25 and lower(btrim(nome))='qualificado' limit 1;
  if tag is null then insert into public.crm_tags(id_empresa,nome,cor) values(25,'Qualificado','#16A34A') returning id into tag; end if;
  insert into public.crm_lead_tags(lead_id,tag_id) values(-91820264,tag);
  assert (select qualification_dispatch_started_at=now() from public.crm_leads where id=-91820264),'tag starts window';
  delete from public.crm_lead_tags where lead_id=-91820264 and tag_id=tag;
  assert (select qualification_dispatch_started_at is null from public.crm_leads where id=-91820264),'tag removal clears window';
end;
$$;
select 'qualification_24h_tests_passed' as result;
