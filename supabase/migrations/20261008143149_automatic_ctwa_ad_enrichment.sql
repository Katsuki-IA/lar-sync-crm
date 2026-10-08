-- Server-only queue and cache. Attribution is never inferred without a CTWA referral.
create table private.ctwa_ad_enrichment (
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  ad_id text not null,
  status text not null default 'pending' check (status in ('pending','running','completed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease uuid,
  locked_until timestamptz,
  details jsonb,
  checked_at timestamptz,
  last_error text,
  primary key (id_empresa,ad_id)
);
alter table private.ctwa_ad_enrichment enable row level security;
revoke all on private.ctwa_ad_enrichment from public,anon,authenticated;
grant all on private.ctwa_ad_enrichment to service_role;
create index ctwa_ad_enrichment_due on private.ctwa_ad_enrichment(next_attempt_at) where status <> 'completed';

create function private.ctwa_enqueue_attribution() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_data->>'capture_type' = 'ctwa' and nullif(new.meta_ad_id,'') is not null
    and (nullif(new.meta_ad_name,'') is null or nullif(new.meta_adset_name,'') is null or nullif(new.meta_campaign_name,'') is null) then
    insert into private.ctwa_ad_enrichment(id_empresa,ad_id) values(new.id_empresa,new.meta_ad_id)
    on conflict(id_empresa,ad_id) do update set status='pending',next_attempt_at=now(),attempts=0
    where ctwa_ad_enrichment.status='completed';
  end if;
  return new;
end $$;
revoke all on function private.ctwa_enqueue_attribution() from public,anon,authenticated;

create function private.ctwa_use_cached_attribution() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cached public.crm_lead_attribution%rowtype;
begin
  if new.raw_data->>'capture_type' = 'ctwa' and nullif(new.meta_ad_id,'') is not null then
    select a.* into cached from public.crm_lead_attribution a
    where a.id_empresa=new.id_empresa and a.meta_ad_id=new.meta_ad_id and a.id<>new.id
      and a.meta_enrichment_error is null and a.meta_enriched_at > now()-interval '24 hours'
      and nullif(a.meta_ad_name,'') is not null and nullif(a.meta_adset_name,'') is not null and nullif(a.meta_campaign_name,'') is not null
    order by a.meta_enriched_at desc limit 1;
    if found then
      new.meta_ad_name := coalesce(nullif(new.meta_ad_name,''),cached.meta_ad_name);
      new.meta_adset_id := coalesce(new.meta_adset_id,cached.meta_adset_id);
      new.meta_adset_name := coalesce(nullif(new.meta_adset_name,''),cached.meta_adset_name);
      new.meta_campaign_id := coalesce(new.meta_campaign_id,cached.meta_campaign_id);
      new.meta_campaign_name := coalesce(nullif(new.meta_campaign_name,''),cached.meta_campaign_name);
      new.meta_account_id := coalesce(new.meta_account_id,cached.meta_account_id);
      new.meta_enriched_at := coalesce(new.meta_enriched_at,cached.meta_enriched_at);
      new.meta_enrichment_error := null;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.ctwa_use_cached_attribution() from public,anon,authenticated;
create trigger ctwa_use_cached_attribution before insert on public.crm_lead_attribution for each row execute function private.ctwa_use_cached_attribution();
create trigger ctwa_enqueue_attribution after insert or update of meta_ad_id,meta_ad_name,meta_adset_name,meta_campaign_name,raw_data on public.crm_lead_attribution for each row execute function private.ctwa_enqueue_attribution();

create function public.ctwa_claim_enrichment() returns table(id_empresa bigint,ad_id text,lease uuid)
language sql security invoker set search_path = '' as $$
  update private.ctwa_ad_enrichment q set status='running',lease=gen_random_uuid(),locked_until=now()+interval '90 seconds',attempts=q.attempts+1
  where (q.id_empresa,q.ad_id) in (
    select j.id_empresa,j.ad_id from private.ctwa_ad_enrichment j
    where (j.status='pending' and j.next_attempt_at<=now() or j.status='running' and j.locked_until<now())
      and exists(select 1 from public.crm_meta_connections c where c.id_empresa=j.id_empresa and c.active and nullif(c.user_access_token,'') is not null)
    order by j.next_attempt_at limit 3 for update skip locked
  ) returning q.id_empresa,q.ad_id,q.lease;
$$;

create function public.ctwa_finish_enrichment(p_company bigint,p_ad text,p_lease uuid,p_details jsonb default null,p_error text default null) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare q private.ctwa_ad_enrichment%rowtype;
begin
  select * into q from private.ctwa_ad_enrichment where id_empresa=p_company and ad_id=p_ad and lease=p_lease and status='running' for update;
  if not found then return false; end if;
  if p_error is null and nullif(p_details->>'meta_ad_name','') is not null and nullif(p_details->>'meta_adset_name','') is not null and nullif(p_details->>'meta_campaign_name','') is not null then
    update public.crm_lead_attribution a set
      meta_ad_name=p_details->>'meta_ad_name',meta_adset_id=p_details->>'meta_adset_id',meta_adset_name=p_details->>'meta_adset_name',
      meta_campaign_id=p_details->>'meta_campaign_id',meta_campaign_name=p_details->>'meta_campaign_name',meta_account_id=p_details->>'meta_account_id',
      meta_enriched_at=now(),meta_enrichment_error=null
    where a.id_empresa=p_company and a.meta_ad_id=p_ad and a.raw_data->>'capture_type'='ctwa'
      and (nullif(a.meta_ad_name,'') is null or nullif(a.meta_adset_name,'') is null or nullif(a.meta_campaign_name,'') is null);
    update private.ctwa_ad_enrichment set status='completed',details=p_details,checked_at=now(),last_error=null,lease=null,locked_until=null where id_empresa=p_company and ad_id=p_ad;
  else
    update private.ctwa_ad_enrichment set status='pending',last_error=left(coalesce(p_error,'Meta retornou nomes incompletos'),500),lease=null,locked_until=null,
      next_attempt_at=now()+make_interval(secs=>least(21600,60*power(5,least(q.attempts-1,4)))::integer)
    where id_empresa=p_company and ad_id=p_ad;
  end if;
  return true;
end $$;
revoke all on function public.ctwa_claim_enrichment() from public,anon,authenticated;
revoke all on function public.ctwa_finish_enrichment(bigint,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.ctwa_claim_enrichment() to service_role;
grant execute on function public.ctwa_finish_enrichment(bigint,text,uuid,jsonb,text) to service_role;

insert into private.ctwa_ad_enrichment(id_empresa,ad_id)
select distinct id_empresa,meta_ad_id from public.crm_lead_attribution
where raw_data->>'capture_type'='ctwa' and nullif(meta_ad_id,'') is not null
and (nullif(meta_ad_name,'') is null or nullif(meta_adset_name,'') is null or nullif(meta_campaign_name,'') is null)
on conflict do nothing;

select cron.schedule('ctwa-ad-attribution-enrichment','* * * * *',$cron$
  select net.http_post(
    url := 'https://tswdxgefmhjvjwafaxjl.supabase.co/functions/v1/ctwa-enrich-attribution',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='meta_watchdog_anon_key'),
      'x-meta-health-secret',(select decrypted_secret from vault.decrypted_secrets where name='meta_health_cron_secret')),
    body := '{}'::jsonb,timeout_milliseconds := 55000)
  where exists(select 1 from private.ctwa_ad_enrichment q where
    (q.status='pending' and q.next_attempt_at<=now() or q.status='running' and q.locked_until<now())
    and exists(select 1 from public.crm_meta_connections c where c.id_empresa=q.id_empresa and c.active and nullif(c.user_access_token,'') is not null));
$cron$);
