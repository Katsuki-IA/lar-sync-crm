-- Aplicar após distribution-v2-candidate.sql. Sem importação retroativa.
begin;
alter table public.hub_sales_queues add column destination_funnel_id bigint references public.crm_funnels(id);
alter table public.crm_opportunities
 add column creation_origin text not null default 'manual' check(creation_origin in ('manual','queue')),
 alter column created_by drop not null,
 add constraint crm_opportunity_creation_actor check
 ((creation_origin='manual' and created_by is not null) or (creation_origin='queue' and created_by is null));
create table private.hub_queue_intake (
 lead_id bigint primary key references public.crm_leads(id) on delete cascade,
 id_empresa bigint not null,
 created_at timestamptz not null default clock_timestamp(),
 next_attempt_at timestamptz not null default clock_timestamp(),
 reason text not null default 'waiting'
);
alter table private.hub_queue_intake enable row level security;
revoke all on private.hub_queue_intake from public,anon,authenticated,service_role;
create index hub_queue_intake_due on private.hub_queue_intake(next_attempt_at,created_at);
create function private.hub_capture_queue_intake() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.hub_company_modules where id_empresa=new.id_empresa and crm) then
  insert into private.hub_queue_intake(lead_id,id_empresa) values(new.id,new.id_empresa)
   on conflict(lead_id) do update set next_attempt_at=clock_timestamp();
 end if;
 return new;
end $$;
create trigger hub_capture_queue_intake_insert after insert on public.crm_leads for each row execute function private.hub_capture_queue_intake();
create trigger hub_capture_queue_intake_update after update of qualificado,crm_stage_id,id_empreendimento on public.crm_leads
 for each row when(old.qualificado is distinct from new.qualificado or old.crm_stage_id is distinct from new.crm_stage_id or old.id_empreendimento is distinct from new.id_empreendimento)
 execute function private.hub_capture_queue_intake();

create function private.hub_process_queue_intake(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare w record;q public.hub_sales_queues;l public.crm_leads;first_stage bigint;op public.crm_opportunities;n integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 1000 then raise exception 'Lote inválido';end if;
 for w in select i.* from private.hub_queue_intake i join public.hub_company_modules cm on cm.id_empresa=i.id_empresa and cm.crm
  where i.next_attempt_at<=clock_timestamp() order by i.next_attempt_at,i.lead_id limit p_limit loop
  begin
   perform 1 from public.hub_company_modules where id_empresa=w.id_empresa and crm for share skip locked;
   if not found then continue;end if;
   select sq.* into q from public.hub_sales_queues sq join public.crm_leads cl on cl.id=w.lead_id and cl.id_empresa=sq.id_empresa
    join public.crm_funnels f on f.id=sq.destination_funnel_id and f.id_empresa=sq.id_empresa and f.module='crm' and f.ativo
    where sq.id_empresa=w.id_empresa and sq.active
    and (sq.development_id is null or sq.development_id=cl.id_empreendimento)
    and ((sq.trigger_qualified and cl.qualificado=1) or cl.crm_stage_id=any(sq.trigger_stage_ids))
    order by (sq.development_id is not null) desc,sq.priority,sq.id for update of sq skip locked limit 1;
   if not found then
    update private.hub_queue_intake set reason='no_matching_queue',next_attempt_at=clock_timestamp()+interval '1 minute' where lead_id=w.lead_id;
    continue;
   end if;
   -- Serialize concurrent lead edits and duplicate opportunity creation.
   select * into l from public.crm_leads where id=w.lead_id and id_empresa=w.id_empresa for update skip locked;
   if not found then continue;end if;
   if not ((q.development_id is null or q.development_id=l.id_empreendimento)
     and ((q.trigger_qualified and l.qualificado=1) or l.crm_stage_id=any(q.trigger_stage_ids))) then continue;end if;
   select id into first_stage from public.crm_stages where id_empresa=w.id_empresa and id_funnel=q.destination_funnel_id and module='crm' and ativo order by ordem,id limit 1;
   if first_stage is null then
    update private.hub_queue_intake set reason='no_active_stage',next_attempt_at=clock_timestamp()+interval '5 minutes' where lead_id=w.lead_id;continue;
   end if;
   insert into public.crm_opportunities(id_empresa,lead_id,funnel_id,stage_id,title,request_id,creation_origin,created_by)
    values(w.id_empresa,l.id,q.destination_funnel_id,first_stage,left(l.nome,200),gen_random_uuid(),'queue',null)
    on conflict(id_empresa,lead_id,funnel_id) do nothing returning * into op;
   if found then
    insert into public.crm_opportunity_events(opportunity_id,id_empresa,actor_id,kind,to_stage_id)
     values(op.id,w.id_empresa,null,'created',first_stage);
    n:=n+1;
   end if;
   -- Existing opportunities, including assigned ones, are never reassigned or reopened.
   delete from private.hub_queue_intake where lead_id=w.lead_id;
  exception when others then
   update private.hub_queue_intake set reason='processing_error',next_attempt_at=clock_timestamp()+interval '5 minutes' where lead_id=w.lead_id;
  end;
 end loop;
 return n;
end $$;
revoke all on function private.hub_capture_queue_intake(),private.hub_process_queue_intake(integer) from public,anon,authenticated,service_role;

-- Extended versions of existing functions appended below.

create or replace function private.hub_save_sales_queue_v2(p_company_id bigint,p_id uuid,p_name text,p_timeout integer,
 p_members uuid[],p_active boolean,p_revision integer,p_request_id uuid,p_rules jsonb)
returns public.hub_sales_queues language plpgsql security definer set search_path='' as $$
declare q public.hub_sales_queues; dev bigint; stages bigint[]; days integer[]; start_time time; end_time time; paused_members uuid[]; payload jsonb; dest bigint;
begin
 if not private.hub_sales_manager_native(p_company_id) then raise exception 'Acesso restrito' using errcode='42501';end if;
 perform 1 from public.hub_company_modules where id_empresa=p_company_id and crm for share;
 if not found then raise exception 'CRM desativado' using errcode='42501';end if;
 if p_rules is null or jsonb_typeof(p_rules)<>'object' then raise exception 'Regras obrigatórias' using errcode='22023';end if;
 dev:=(p_rules->>'development_id')::bigint;
 dest:=(p_rules->>'destination_funnel_id')::bigint;
 if ((p_rules->>'trigger_qualified')::boolean or jsonb_array_length(p_rules->'trigger_stage_ids')>0) and dest is null then
  raise exception 'Escolha o funil comercial de destino' using errcode='22023';end if;
 if dest is not null and not exists(select 1 from public.crm_funnels f where f.id=dest and f.id_empresa=p_company_id and f.module='crm' and f.ativo
  and exists(select 1 from public.crm_stages s where s.id_funnel=f.id and s.id_empresa=p_company_id and s.module='crm' and s.ativo)) then
  raise exception 'Funil comercial sem etapa ativa ou de outra empresa' using errcode='22023';end if;
 stages:=array(select jsonb_array_elements_text(p_rules->'trigger_stage_ids')::bigint);
 days:=array(select jsonb_array_elements_text(p_rules->'weekdays')::integer);
 start_time:=(p_rules->>'starts_at')::time;end_time:=(p_rules->>'ends_at')::time;
 if dev is not null and not exists(select 1 from public.empreendimento where id=dev and id_empresa=p_company_id) then
  raise exception 'Empreendimento inválido' using errcode='22023';end if;
 if cardinality(stages)>100 or exists(select 1 from unnest(stages) s where not exists
  (select 1 from public.crm_stages where id=s and id_empresa=p_company_id and module='ia' and ativo)) then
  raise exception 'Escolha etapas IA ativas da empresa' using errcode='22023';end if;
 if (p_rules->>'trigger_qualified')::boolean is null or (p_rules->>'schedule_enabled')::boolean is null
  or start_time is null or end_time is null or start_time>=end_time
  or cardinality(days) not between 1 and 7 or exists(select 1 from unnest(days) d where d not between 1 and 7)
  or (p_rules->>'priority')::integer is null or (p_rules->>'priority')::integer not between 1 and 1000 then
  raise exception 'Revise dias, horários e prioridade. O término deve ser após o início.' using errcode='22023';end if;
 payload:=jsonb_build_object('name',btrim(p_name),'timeout',p_timeout,'members',p_members,'active',p_active,'rules',p_rules);
 if p_id is null then
  if p_request_id is null then raise exception 'Solicitação obrigatória' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||p_request_id::text,41));
  select * into q from public.hub_sales_queues where id_empresa=p_company_id and request_id=p_request_id;
  if found then
   if q.routing_creation_payload is distinct from payload then raise exception 'Solicitação reutilizada com outros dados' using errcode='22023';end if;
   return q;
  end if;
 else
  perform 1 from public.hub_sales_queues where id=p_id and id_empresa=p_company_id for update;
  select array_agg(member_id) into paused_members from public.hub_sales_queue_members where queue_id=p_id and paused;
 end if;
 -- Reuse tenant checks, optimistic revision, membership validation and auditing atomically.
 q:=private.hub_save_sales_queue_native(p_company_id,p_id,p_name,p_timeout,p_members,p_active,p_revision,p_request_id);
 update public.hub_sales_queues set destination_funnel_id=dest,development_id=dev,trigger_qualified=(p_rules->>'trigger_qualified')::boolean,
  trigger_stage_ids=stages,schedule_enabled=(p_rules->>'schedule_enabled')::boolean,weekdays=days,
  starts_at=start_time,ends_at=end_time,priority=(p_rules->>'priority')::integer,
  routing_creation_payload=case when p_id is null then payload else routing_creation_payload end where id=q.id returning * into q;
 update public.hub_sales_queue_members set paused=true where queue_id=q.id and member_id=any(coalesce(paused_members,'{}'));
 insert into public.hub_sales_queue_events(queue_id,id_empresa,actor_id,before_data,after_data)
  values(q.id,p_company_id,private.hub_sales_actor_id(),null,jsonb_build_object('rules',p_rules));
 return q;
end $$;

create or replace function private.hub_queue_matches(p_queue uuid,p_opportunity uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hub_sales_queues q
 join public.crm_opportunities op on op.id=p_opportunity and op.id_empresa=q.id_empresa
 join public.crm_leads l on l.id=op.lead_id and l.id_empresa=op.id_empresa
 where q.id=p_queue and op.assigned_to is null
 and (q.destination_funnel_id is null or q.destination_funnel_id=op.funnel_id)
 and (q.development_id is null or q.development_id=l.id_empreendimento)
 and ((q.trigger_qualified and l.qualificado=1) or l.crm_stage_id=any(q.trigger_stage_ids)))
$$;

CREATE OR REPLACE FUNCTION private.hub_run_sales_queue_worker(p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare candidate record;started timestamptz:=clock_timestamp();processed integer:=0;failed integer:=0;skipped integer:=0;failure_code text;
begin
 if p_limit is null or p_limit not between 1 and 1000 then raise exception 'Invalid worker batch size'; end if;
 -- A duplicate scheduler/manual invocation must not process another batch concurrently.
 if not pg_try_advisory_xact_lock(739251,4173) then return jsonb_build_object('status','already_running');end if;
 for candidate in
  select d.id,d.id_empresa,d.queue_id,d.opportunity_id
  from public.hub_sales_distributions d
  join public.hub_company_modules m on m.id_empresa=d.id_empresa and m.crm
  join public.hub_sales_queues q on q.id=d.queue_id and q.active
  join public.crm_opportunities op on op.id=d.opportunity_id
  left join public.hub_sales_offers o on o.distribution_id=d.id and o.status='pending'
  left join public.crm_users u on u.id=o.member_id
  left join private.sales_worker_failures f on f.distribution_id=d.id
  where d.status='pending' and (f.next_attempt_at is null or f.next_attempt_at<=clock_timestamp())
   and ((o.id is null and private.hub_queue_is_open(q.id) and exists(
    select 1 from public.hub_sales_queue_members qm join public.crm_users qu on qu.id=qm.member_id and qu.id_empresa=qm.id_empresa
    where qm.queue_id=q.id and not qm.paused and qu.active and qu.role in ('agent','corretor')))
    or (o.id is not null and (o.expires_at<=clock_timestamp() or u.active is distinct from true or u.role not in ('agent','corretor')))
    or op.assigned_to is not null)
  order by coalesce(o.expires_at,d.created_at),d.id limit p_limit
 loop
  begin
   -- Recheck under locks. Skip busy records rather than waiting behind an acceptance.
   perform 1 from public.hub_company_modules where id_empresa=candidate.id_empresa and crm for share skip locked;
   if not found then skipped:=skipped+1;continue;end if;
   perform 1 from public.hub_sales_queues where id=candidate.queue_id and active for update skip locked;
   if not found then skipped:=skipped+1;continue;end if;
   perform 1 from public.crm_opportunities where id=candidate.opportunity_id for update skip locked;
   if not found then skipped:=skipped+1;continue;end if;
   perform private.hub_advance_sales_distribution_locked(candidate.id,false);
   delete from private.sales_worker_failures where distribution_id=candidate.id;
   processed:=processed+1;
  exception when others then
   -- Subtransaction rolls back this item's changes. Continue other companies/items.
   get stacked diagnostics failure_code=returned_sqlstate;
   insert into private.sales_worker_failures(distribution_id,attempts,last_sqlstate,next_attempt_at)
   values(candidate.id,1,failure_code,clock_timestamp()+interval '1 minute')
   on conflict(distribution_id) do update set attempts=least(sales_worker_failures.attempts+1,100000),last_sqlstate=excluded.last_sqlstate,
    next_attempt_at=clock_timestamp()+make_interval(mins=>least(30,sales_worker_failures.attempts+1)),updated_at=clock_timestamp();
   failed:=failed+1;
  end;
 end loop;
 perform private.hub_process_queue_intake(p_limit);
 perform private.hub_route_sales_waiting(p_limit);
 insert into private.sales_worker_runs(started_at,finished_at,processed,failed,skipped) values(started,clock_timestamp(),processed,failed,skipped);
 -- Only this worker's operational logs are retained for 30 days; business history is preserved.
 delete from private.sales_worker_runs where started_at<clock_timestamp()-interval '30 days';
 return jsonb_build_object('status','completed','processed',processed,'failed',failed,'skipped',skipped);
end $function$
;

create or replace function private.hub_sales_queue_overview(p_company_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.hub_sales_manager_native(p_company_id) then raise exception 'Acesso restrito' using errcode='42501';end if;
 return jsonb_build_object('installed',true,'intake_installed',true,
 'lead_waiting',coalesce((select jsonb_agg(to_jsonb(x)) from (select i.lead_id,l.nome,i.created_at,i.reason from private.hub_queue_intake i
 join public.crm_leads l on l.id=i.lead_id and l.id_empresa=i.id_empresa where i.id_empresa=p_company_id order by i.created_at,i.lead_id limit 100) x),'[]'::jsonb),'pending',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('queue_id',d.queue_id) order by o.expires_at)
  from public.hub_sales_offers o join public.hub_sales_distributions d on d.id=o.distribution_id and d.id_empresa=o.id_empresa
  where o.id_empresa=p_company_id and o.status='pending' and d.status='pending'),'[]'::jsonb),
 'stats',coalesce((select jsonb_agg(to_jsonb(s)) from (
  select d.queue_id,o.member_id,count(*) as received,count(*) filter(where o.status='accepted') as accepted,
  avg(extract(epoch from o.resolved_at-o.created_at)/60) filter(where o.status='accepted' and o.resolved_at>=o.created_at) as mean_minutes
  from public.hub_sales_offers o join public.hub_sales_distributions d on d.id=o.distribution_id and d.id_empresa=o.id_empresa
  where o.id_empresa=p_company_id group by d.queue_id,o.member_id) s),'[]'::jsonb),
 'waiting',coalesce((select jsonb_agg(to_jsonb(w)) from (
  select w.opportunity_id,op.title,l.nome as lead_name,w.created_at,w.next_attempt_at,w.reason
  from private.hub_sales_waiting w join public.crm_opportunities op on op.id=w.opportunity_id and op.id_empresa=w.id_empresa
  join public.crm_leads l on l.id=op.lead_id and l.id_empresa=w.id_empresa
  where w.id_empresa=p_company_id and op.assigned_to is null
  and not exists(select 1 from public.hub_sales_distributions d where d.opportunity_id=op.id and d.status='pending')
  order by w.created_at,w.opportunity_id limit 100) w),'[]'::jsonb));
end $$;
commit;
