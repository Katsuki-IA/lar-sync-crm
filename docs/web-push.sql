-- Private Web Push state: only the authenticated Edge Function's service role can call this API.
create table private.hub_push_config(
 id boolean primary key default true check(id), public_key text, private_key text,
 worker_key text not null default(gen_random_uuid()::text||gen_random_uuid()::text)
);
insert into private.hub_push_config(id) values(true);
create table private.hub_push_subscriptions(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.crm_users(id),
 endpoint text not null unique check(length(endpoint)<=2048), p256dh text not null, auth_key text not null,
 origin text not null check(origin in ('https://hub.katsuki.com.br','https://myhub.katsuki.com.br','https://lar-sync-crm.lovable.app')),
 enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index hub_push_subscriptions_user on private.hub_push_subscriptions(user_id) where enabled;
create table private.hub_push_deliveries(
 id uuid primary key default gen_random_uuid(), subscription_id uuid not null references private.hub_push_subscriptions(id) on delete cascade,
 user_id uuid not null references public.crm_users(id), event_key text not null,
 state text not null default 'pending' check(state in ('pending','sending','sent','failed','cancelled')),
 attempts int not null default 0, next_at timestamptz not null default now(), locked_until timestamptz, token uuid,
 http_status int, created_at timestamptz not null default now(), sent_at timestamptz,
 unique(subscription_id,event_key)
);
create index hub_push_deliveries_pending on private.hub_push_deliveries(next_at) where state in ('pending','sending');
alter table private.hub_push_config enable row level security;
alter table private.hub_push_subscriptions enable row level security;
alter table private.hub_push_deliveries enable row level security;
revoke all on private.hub_push_config,private.hub_push_subscriptions,private.hub_push_deliveries from public,anon,authenticated;
grant select,insert,update,delete on private.hub_push_config,private.hub_push_subscriptions,private.hub_push_deliveries to service_role;

create view private.hub_push_events with(security_invoker=true) as
select 'prospect:'||h.id::text event_key,u.id user_id,c.id_empresa,
 'Novo atendimento'::text title,coalesce(e.nome,'Hub')||': um lead respondeu e aguarda seu atendimento.' body,
 '/conversas?lead='||c.crm_lead_id||'&push_company='||c.id_empresa path,h.created_at,
 h.created_at+interval '24 hours' expires_at
from private.kp_handoffs h join private.kp_contacts c on c.id=h.contact_id
join private.kp_companies cfg on cfg.id_empresa=c.id_empresa and cfg.enabled
join public.crm_users u on u.id=cfg.recipient_id and u.active and u.role='super_admin'
join public.hub_company_modules m on m.id_empresa=c.id_empresa and m.crm
join public.empresa_dados e on e.id=c.id_empresa
where h.status<>'assumed' and h.created_at>now()-interval '24 hours'
union all
select 'offer:'||o.id,u.id,o.id_empresa,'Nova oferta de lead',
 coalesce(e.nome,'Hub')||': há uma oferta de lead aguardando seu aceite.',
 '/filas?push_company='||o.id_empresa,o.created_at,o.expires_at
from public.hub_sales_offers o join public.crm_users u on u.id=o.member_id and u.active and u.role='agent' and u.id_empresa=o.id_empresa
join public.hub_company_modules m on m.id_empresa=o.id_empresa and m.crm
join public.empresa_dados e on e.id=o.id_empresa
where o.status='pending' and o.expires_at>now() and o.created_at>now()-interval '24 hours'
union all
select 'notice:'||n.id,u.id,u.id_empresa,'Novo aviso no Hub',
 'Você recebeu um novo aviso. Abra o sino de notificações no Hub.',
 '/dashboard',n.created_at,n.created_at+interval '24 hours'
from public.crm_notifications n join public.crm_users u on u.active
where n.created_at>now()-interval '24 hours'
and (n.all_empresas or exists(select 1 from public.crm_notification_targets t where t.notification_id=n.id and t.id_empresa=u.id_empresa))
and not exists(select 1 from public.crm_notification_reads r where r.notification_id=n.id and r.crm_user_id=u.id);
revoke all on private.hub_push_events from public,anon,authenticated;
grant select on private.hub_push_events to service_role;

create function public.hub_push_service(p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql set search_path='' as $fn$
declare v_user public.crm_users;v_sub private.hub_push_subscriptions;v_cfg private.hub_push_config;result jsonb;v_delivery private.hub_push_deliveries;
begin
 if p_action='worker_auth' then
  return to_jsonb(exists(select 1 from private.hub_push_config where worker_key=p_data->>'key'));
 end if;
 if p_action='config' then
  select * into v_cfg from private.hub_push_config where id for update;
  if v_cfg.public_key is null then
   if length(p_data->>'publicKey')<>87 or length(p_data->>'privateKey')<>43 then raise exception 'Invalid VAPID keys';end if;
   update private.hub_push_config set public_key=p_data->>'publicKey',private_key=p_data->>'privateKey' where id returning * into v_cfg;
  end if;
  return jsonb_build_object('publicKey',v_cfg.public_key);
 end if;
 if p_action in ('register','unregister','status','test') then
  select * into v_user from public.crm_users where auth_user_id=(p_data->>'authUser')::uuid and active;
  if v_user.id is null then raise exception 'Active CRM account required';end if;
  if p_action='register' then
   perform pg_advisory_xact_lock(hashtextextended(v_user.id::text,1));
   if (select count(*) from private.hub_push_subscriptions where user_id=v_user.id and enabled)>=10
    and not exists(select 1 from private.hub_push_subscriptions where endpoint=p_data->>'endpoint' and user_id=v_user.id and enabled) then raise exception 'Device limit reached';end if;
   insert into private.hub_push_subscriptions(user_id,endpoint,p256dh,auth_key,origin)
   values(v_user.id,p_data->>'endpoint',p_data->>'p256dh',p_data->>'auth',p_data->>'origin')
   on conflict(endpoint) do update set user_id=excluded.user_id,p256dh=excluded.p256dh,auth_key=excluded.auth_key,
    origin=excluded.origin,enabled=true,updated_at=now(),
    created_at=case when hub_push_subscriptions.user_id<>excluded.user_id or not hub_push_subscriptions.enabled then now() else hub_push_subscriptions.created_at end
   returning * into v_sub;
   return jsonb_build_object('enabled',true,'userId',v_user.id);
  elsif p_action='unregister' then
   update private.hub_push_subscriptions set enabled=false,updated_at=now() where user_id=v_user.id and endpoint=p_data->>'endpoint';
   return '{"enabled":false}'::jsonb;
  elsif p_action='status' then
   return jsonb_build_object('enabled',exists(select 1 from private.hub_push_subscriptions where user_id=v_user.id and endpoint=p_data->>'endpoint' and enabled),'userId',v_user.id);
  else
   select * into v_sub from private.hub_push_subscriptions where user_id=v_user.id and endpoint=p_data->>'endpoint' and enabled for update;
   if v_sub.id is null then raise exception 'Enable notifications first';end if;
   if exists(select 1 from private.hub_push_deliveries where subscription_id=v_sub.id and event_key like 'test:%' and created_at>now()-interval '1 minute') then raise exception 'Wait one minute before testing again';end if;
   insert into private.hub_push_deliveries(subscription_id,user_id,event_key) values(v_sub.id,v_user.id,'test:'||gen_random_uuid());
   return '{"queued":true}'::jsonb;
  end if;
 end if;
 if p_action='claim' then
  insert into private.hub_push_deliveries(subscription_id,user_id,event_key)
   select s.id,s.user_id,e.event_key from private.hub_push_subscriptions s join private.hub_push_events e on e.user_id=s.user_id
   where s.enabled and e.created_at>=s.created_at and e.expires_at>now()
   on conflict do nothing;
  update private.hub_push_deliveries d set state='cancelled'
   where d.state in ('pending','sending') and (
    not exists(select 1 from private.hub_push_subscriptions s join public.crm_users u on u.id=s.user_id and u.active
      where s.id=d.subscription_id and s.enabled and s.user_id=d.user_id)
    or (d.event_key not like 'test:%' and not exists(select 1 from private.hub_push_events e where e.user_id=d.user_id and e.event_key=d.event_key and e.expires_at>now()))
    or (d.event_key like 'test:%' and d.created_at<now()-interval '5 minutes'));
  update private.hub_push_deliveries set state='failed' where attempts>=4 and state in ('pending','sending') and coalesce(locked_until,now())<=now();
  with picked as (
   select id from private.hub_push_deliveries where attempts<4 and next_at<=now()
    and (state='pending' or (state='sending' and locked_until<now())) order by created_at for update skip locked limit 30
  ), claimed as (
   update private.hub_push_deliveries d set state='sending',attempts=attempts+1,token=gen_random_uuid(),locked_until=now()+interval '2 minutes'
   from picked p where p.id=d.id returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
   'id',d.id,'token',d.token,'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth_key)),
   'ttl',greatest(1,least(3600,extract(epoch from (coalesce(e.expires_at,d.created_at+interval '5 minutes')-now()))::int)),
   'payload',jsonb_build_object('title',coalesce(e.title,'Notificações ativadas'),'body',coalesce(e.body,'Este é um teste das notificações do Hub.'),
    'url',s.origin||coalesce(e.path,'/dashboard'),'tag',d.event_key,'userId',d.user_id)
  )),'[]'::jsonb) into result from claimed d join private.hub_push_subscriptions s on s.id=d.subscription_id
  left join private.hub_push_events e on e.event_key=d.event_key and e.user_id=d.user_id;
  select * into v_cfg from private.hub_push_config where id;
  return jsonb_build_object('jobs',result,'publicKey',v_cfg.public_key,'privateKey',v_cfg.private_key);
 end if;
 if p_action='finish' then
  select * into v_delivery from private.hub_push_deliveries where id=(p_data->>'id')::uuid and token=(p_data->>'token')::uuid and state='sending' for update;
  if v_delivery.id is null then return '{"updated":false}'::jsonb;end if;
  update private.hub_push_deliveries set
   state=case when (p_data->>'status')::int between 200 and 299 then 'sent'
     when ((p_data->>'status')::int in (0,429) or (p_data->>'status')::int>=500) and attempts<4 then 'pending' else 'failed' end,
   http_status=(p_data->>'status')::int,locked_until=null,next_at=now()+attempts*interval '1 minute',
   sent_at=case when (p_data->>'status')::int between 200 and 299 then now() else null end where id=v_delivery.id;
  if (p_data->>'status')::int in (404,410) then update private.hub_push_subscriptions set enabled=false where id=v_delivery.subscription_id;end if;
  return '{"updated":true}'::jsonb;
 end if;
 raise exception 'Unknown action';
end $fn$;
revoke all on function public.hub_push_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.hub_push_service(text,jsonb) to service_role;
grant usage on schema private to service_role;
grant select(id,contact_id,status,created_at) on private.kp_handoffs to service_role;
grant select(id,id_empresa,crm_lead_id) on private.kp_contacts to service_role;
grant select(id_empresa,enabled,recipient_id) on private.kp_companies to service_role;
