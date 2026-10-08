-- All fixtures are rolled back; no contacts, messages or Meta requests are created.
begin;
do $$
declare original public.crm_lead_attribution%rowtype; fixture public.crm_lead_attribution%rowtype; target bigint; claimed record; n integer; before_at timestamptz;
begin
  select * into original from public.crm_lead_attribution
  where raw_data->>'capture_type'='ctwa' and meta_enriched_at>now()-interval '24 hours'
    and meta_ad_name is not null and meta_adset_name is not null and meta_campaign_name is not null limit 1;
  if not found then raise exception 'No complete CTWA fixture'; end if;
  fixture:=original; fixture.id:=gen_random_uuid(); fixture.meta_leadgen_id:=null;
  fixture.meta_ad_name:=null; fixture.meta_adset_name:=null; fixture.meta_campaign_name:=null; fixture.meta_enriched_at:=null;
  insert into public.crm_lead_attribution select fixture.*;
  select * into fixture from public.crm_lead_attribution where id=fixture.id;
  if fixture.meta_ad_name is distinct from original.meta_ad_name or fixture.meta_campaign_name is distinct from original.meta_campaign_name then raise exception 'Cache not used'; end if;

  select id_empresa,crm_lead_id into fixture.id_empresa,fixture.crm_lead_id from public.crm_lead_attribution where id_empresa<>original.id_empresa limit 1;
  fixture.id:=gen_random_uuid(); fixture.meta_ad_name:=null; fixture.meta_adset_name:=null; fixture.meta_campaign_name:=null; fixture.meta_enriched_at:=null;
  insert into public.crm_lead_attribution select fixture.*;
  if exists(select 1 from public.crm_lead_attribution a where a.id=fixture.id and a.meta_campaign_name=original.meta_campaign_name) then raise exception 'Cross-company cache leak'; end if;

  fixture:=original; fixture.id:=gen_random_uuid(); fixture.meta_leadgen_id:=null; fixture.meta_ad_id:='999999999999999901';
  fixture.meta_ad_name:=null; fixture.meta_adset_name:=null; fixture.meta_campaign_name:=null; fixture.meta_enriched_at:=null;
  insert into public.crm_lead_attribution select fixture.*;
  fixture.id:=gen_random_uuid(); insert into public.crm_lead_attribution select fixture.*;
  select count(*) into n from private.ctwa_ad_enrichment where id_empresa=original.id_empresa and ad_id=fixture.meta_ad_id;
  if n<>1 then raise exception 'Queue not deduplicated'; end if;
  for claimed in select * from public.ctwa_claim_enrichment() loop
    if claimed.ad_id=fixture.meta_ad_id then
      if exists(select 1 from public.ctwa_claim_enrichment() again where again.ad_id=claimed.ad_id and again.id_empresa=claimed.id_empresa) then raise exception 'Lease not respected'; end if;
      if public.ctwa_finish_enrichment(claimed.id_empresa,claimed.ad_id,gen_random_uuid(),null,'wrong lease') then raise exception 'Wrong lease accepted'; end if;
      perform public.ctwa_finish_enrichment(claimed.id_empresa,claimed.ad_id,claimed.lease,null,'test transient error');
      if not exists(select 1 from private.ctwa_ad_enrichment where id_empresa=claimed.id_empresa and ad_id=claimed.ad_id and status='pending' and next_attempt_at>now()) then raise exception 'Retry not delayed'; end if;
      update private.ctwa_ad_enrichment set next_attempt_at=now() where id_empresa=claimed.id_empresa and ad_id=claimed.ad_id;
    end if;
  end loop;
  for claimed in select * from public.ctwa_claim_enrichment() loop
    if claimed.ad_id=fixture.meta_ad_id then
      perform public.ctwa_finish_enrichment(claimed.id_empresa,claimed.ad_id,claimed.lease,jsonb_build_object('meta_ad_name','Test ad','meta_adset_name','Test set','meta_campaign_name','Test campaign'));
    end if;
  end loop;
  select count(*) into n from public.crm_lead_attribution where id_empresa=original.id_empresa and meta_ad_id=fixture.meta_ad_id and meta_campaign_name='Test campaign';
  if n<>2 then raise exception 'Shared result did not fill both leads'; end if;
  fixture.id:=gen_random_uuid(); fixture.meta_ad_id:='999999999999999902'; fixture.raw_data:='{"capture_type":"lead_ads"}'; fixture.meta_ad_name:=null; fixture.meta_adset_name:=null; fixture.meta_campaign_name:=null;
  insert into public.crm_lead_attribution select fixture.*;
  if exists(select 1 from private.ctwa_ad_enrichment where ad_id=fixture.meta_ad_id) then raise exception 'Form enqueued as CTWA'; end if;
  if has_function_privilege('authenticated','public.ctwa_claim_enrichment()','execute') or has_function_privilege('anon','public.ctwa_finish_enrichment(bigint,text,uuid,jsonb,text)','execute') or has_table_privilege('authenticated','private.ctwa_ad_enrichment','select') then raise exception 'Server permissions exposed'; end if;
end $$;
rollback;
select 'cache, company isolation, queue deduplication, leases, retries, shared results, form exclusion and permissions passed' as result;
