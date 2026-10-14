-- Run after the migration inside BEGIN/ROLLBACK. Never commit fixtures or send messages.
do $test$
declare
  actor_a public.crm_users%rowtype;
  actor_b public.crm_users%rowtype;
  actor_super public.crm_users%rowtype;
  actor_other public.crm_users%rowtype;
  external_company bigint;
  recorded bigint;
begin
  select * into strict actor_a from public.crm_users where id_empresa=31 and role='manager' and active=true order by id limit 1;
  select * into strict actor_b from public.crm_users where id_empresa=31 and role='manager' and active=true and id<>actor_a.id order by id limit 1;
  select * into strict actor_super from public.crm_users where role='super_admin' and active=true order by id limit 1;
  select * into strict actor_other from public.crm_users where id_empresa=9 and role='manager' and active=true order by id limit 1;
  select id_empresa into strict external_company from public.credentials where lower(default_crm)<>'hub' order by id_empresa limit 1;
  assert not exists(select 1 from public.crm_leads where id in (-91820264,-91820266));
  assert not exists(select 1 from public.lead where id in (-91820265,-91820267));
  insert into public.crm_leads(id,id_empresa,nome,telefone,crm_assigned_to)
    values(-91820264,31,'Synthetic owner rollback test','5500000000000',actor_b.id),
          (-91820266,external_company,'Synthetic external identity rollback test','5500000000001',null);
  insert into public.lead(id,id_empresa,nome,numero,id_crm)
    values(-91820265,31,'Synthetic owner rollback test','5500000000000','-91820264'),
          (-91820267,external_company,'Synthetic external identity rollback test','5500000000001','-91820266');
  perform set_config('request.jwt.claim.sub',actor_a.auth_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_a.auth_user_id,'role','authenticated')::text,true);
  perform * from public.crm_whatsapp_set_conversation_attendance(-91820265,true,false);
  assert (select crm_assigned_to=actor_a.id from public.crm_leads where id=-91820264),'claim must update lead owner';
  assert (select wa_conversation_assigned_to=actor_a.id from public.lead where id=-91820265);
  select count(*) into recorded from public.crm_lead_activities where lead_id=-91820264 and metadata->>'source'='hub_conversation_lead_owner';
  assert recorded=1,'owner audit must be written';
  perform * from public.crm_whatsapp_set_conversation_attendance(-91820265,true,false);
  assert (select count(*)=recorded from public.crm_lead_activities where lead_id=-91820264 and metadata->>'source'='hub_conversation_lead_owner'),'same actor must not duplicate audit';
  perform set_config('request.jwt.claim.sub',actor_b.auth_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_b.auth_user_id,'role','authenticated')::text,true);
  begin
    perform * from public.crm_whatsapp_set_conversation_attendance(-91820265,true,false);
    raise exception 'conflicting claim was accepted';
  exception when sqlstate '55000' then null;
  end;
  assert (select crm_assigned_to=actor_a.id from public.crm_leads where id=-91820264);
  perform * from public.crm_whatsapp_set_conversation_attendance(-91820265,true,true);
  assert (select crm_assigned_to=actor_b.id from public.crm_leads where id=-91820264),'forced transfer updates owner';
  perform * from public.crm_whatsapp_set_conversation_attendance(-91820265,false,false);
  assert (select crm_assigned_to=actor_b.id from public.crm_leads where id=-91820264),'returning to AI retains the lead owner';
  assert (select wa_conversation_assigned_to is null from public.lead where id=-91820265);
  perform set_config('request.jwt.claim.sub',actor_super.auth_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_super.auth_user_id,'role','authenticated')::text,true);
  perform * from public.crm_whatsapp_set_conversation_attendance(-91820265,true,true);
  assert (select crm_assigned_to=actor_super.id from public.crm_leads where id=-91820264),'superadmin owner may belong to another company';
  perform * from public.crm_whatsapp_set_conversation_attendance(-91820267,true,true);
  assert (select crm_assigned_to is null from public.crm_leads where id=-91820266),'external CRM numeric ID cannot overwrite a Hub lead';
  perform set_config('request.jwt.claim.sub',actor_a.auth_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_a.auth_user_id,'role','authenticated')::text,true);
  assert exists(select 1 from public.crm_lead_assignee_options(31) where id=actor_super.id),'manager can filter a lead assigned to a superadmin';
  assert not exists(select 1 from public.crm_lead_assignee_options(31) where id=actor_other.id),'other company users must not be listed';
  begin
    perform * from public.crm_lead_assignee_options(9);
    raise exception 'cross company options were accepted';
  exception when sqlstate '42501' then null;
  end;
  update public.crm_leads set lead_id=-91820267 where id=-91820264;
  perform * from public.crm_whatsapp_set_conversation_attendance(-91820265,true,true);
  assert (select crm_assigned_to=actor_super.id from public.crm_leads where id=-91820264),'conflicting direct link must not change owner';
  perform set_config('request.jwt.claim.sub',actor_other.auth_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_other.auth_user_id,'role','authenticated')::text,true);
  begin
    perform * from public.crm_whatsapp_set_conversation_attendance(-91820265,true,true);
    raise exception 'cross company claim was accepted';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform * from public.crm_lead_assignee_options(31);
    raise exception 'anonymous options were accepted';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform * from public.crm_whatsapp_set_conversation_attendance(-91820265,true,true);
    raise exception 'anonymous claim was accepted';
  exception when sqlstate '42501' then null;
  end;
  assert not has_function_privilege('anon','public.crm_lead_assignee_options(bigint)','execute');
  assert has_function_privilege('authenticated','public.crm_lead_assignee_options(bigint)','execute');
end;
$test$;
select 'conversation_owner_claim_transfer_release_scope_audit_options_passed' as result;
