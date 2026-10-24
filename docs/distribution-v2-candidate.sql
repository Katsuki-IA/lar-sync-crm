-- CANDIDATO: validar em homologação antes de aplicar em produção.
-- Não altera credenciais, envio WhatsApp nem cria oportunidades a partir de leads.
-- O gatilho recebe oportunidades comerciais sem responsável. Sem backfill automático.
begin;
alter table public.hub_sales_queues
 add column development_id bigint references public.empreendimento(id),
 add column trigger_qualified boolean not null default false,
 add column trigger_stage_ids bigint[] not null default '{}',
 add column schedule_enabled boolean not null default false,
 add column weekdays integer[] not null default '{1,2,3,4,5}',
 add column starts_at time not null default '08:00',
 add column ends_at time not null default '18:00',
 add column timezone text not null default 'America/Sao_Paulo',
 add column priority integer not null default 100 check(priority between 1 and 1000),
 add column routing_creation_payload jsonb;
alter table public.hub_sales_queue_members add column paused boolean not null default false;
-- A execução automática não deve ser atribuída a um usuário humano.
alter table public.hub_sales_distributions
 add column origin text not null default 'manual' check (origin in ('manual','automatic')),
 alter column created_by drop not null,
 add constraint hub_sales_distribution_actor check
  ((origin='manual' and created_by is not null) or (origin='automatic' and created_by is null));
create table private.hub_sales_waiting (
 opportunity_id uuid primary key references public.crm_opportunities(id),
 id_empresa bigint not null,
 created_at timestamptz not null default clock_timestamp(),
 next_attempt_at timestamptz not null default clock_timestamp(),
 reason text not null default 'waiting',
 attempts integer not null default 0
);
alter table private.hub_sales_waiting enable row level security;
revoke all on private.hub_sales_waiting from public,anon,authenticated,service_role;
create index hub_sales_waiting_due on private.hub_sales_waiting(next_attempt_at,created_at);

create function private.hub_queue_is_open(p_queue uuid,p_now timestamptz default clock_timestamp())
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select q.active and (not q.schedule_enabled or
  (extract(isodow from p_now at time zone q.timezone)::integer=any(q.weekdays)
   and (p_now at time zone q.timezone)::time>=q.starts_at
   and (p_now at time zone q.timezone)::time<q.ends_at))
 from public.hub_sales_queues q where q.id=p_queue),false)
$$;

create function private.hub_queue_matches(p_queue uuid,p_opportunity uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hub_sales_queues q
 join public.crm_opportunities op on op.id=p_opportunity and op.id_empresa=q.id_empresa
 join public.crm_leads l on l.id=op.lead_id and l.id_empresa=op.id_empresa
 where q.id=p_queue and op.assigned_to is null
 and (q.development_id is null or q.development_id=l.id_empreendimento)
 and ((q.trigger_qualified and l.qualificado=1) or l.crm_stage_id=any(q.trigger_stage_ids)))
$$;

-- Triggers enqueue only; no network, AI call or recursive offer creation in the write transaction.
create function private.hub_track_sales_waiting() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='crm_opportunities' then
  if new.assigned_to is null then
   insert into private.hub_sales_waiting(opportunity_id,id_empresa) values(new.id,new.id_empresa)
   on conflict(opportunity_id) do nothing;
  else delete from private.hub_sales_waiting where opportunity_id=new.id; end if;
 elsif tg_table_name='crm_leads' then
  insert into private.hub_sales_waiting(opportunity_id,id_empresa)
   select id,id_empresa from public.crm_opportunities where lead_id=new.id and id_empresa=new.id_empresa and assigned_to is null
   on conflict(opportunity_id) do nothing;
 elsif tg_table_name='hub_sales_distributions' and new.status='cancelled' and old.status is distinct from new.status then
  delete from private.hub_sales_waiting where opportunity_id=new.opportunity_id;
 elsif tg_table_name='hub_sales_distributions' and new.status='exhausted' and old.status is distinct from new.status then
  insert into private.hub_sales_waiting(opportunity_id,id_empresa,next_attempt_at,reason)
   values(new.opportunity_id,new.id_empresa,clock_timestamp()+interval '30 minutes','no_acceptance')
   on conflict(opportunity_id) do update set next_attempt_at=excluded.next_attempt_at,reason=excluded.reason;
 end if;
 return new;
end $$;
create trigger hub_queue_opportunity_waiting after insert or update of assigned_to on public.crm_opportunities
 for each row execute function private.hub_track_sales_waiting();
create trigger hub_queue_lead_waiting after update of qualificado,crm_stage_id,id_empreendimento on public.crm_leads
 for each row when (old.qualificado is distinct from new.qualificado or old.crm_stage_id is distinct from new.crm_stage_id or old.id_empreendimento is distinct from new.id_empreendimento)
 execute function private.hub_track_sales_waiting();
create trigger hub_queue_retry_waiting after update of status on public.hub_sales_distributions
 for each row execute function private.hub_track_sales_waiting();

create function private.hub_save_sales_queue_v2(p_company_id bigint,p_id uuid,p_name text,p_timeout integer,
 p_members uuid[],p_active boolean,p_revision integer,p_request_id uuid,p_rules jsonb)
returns public.hub_sales_queues language plpgsql security definer set search_path='' as $$
declare q public.hub_sales_queues; dev bigint; stages bigint[]; days integer[]; start_time time; end_time time; paused_members uuid[]; payload jsonb;
begin
 if not private.hub_sales_manager_native(p_company_id) then raise exception 'Acesso restrito' using errcode='42501';end if;
 perform 1 from public.hub_company_modules where id_empresa=p_company_id and crm for share;
 if not found then raise exception 'CRM desativado' using errcode='42501';end if;
 if p_rules is null or jsonb_typeof(p_rules)<>'object' then raise exception 'Regras obrigatórias' using errcode='22023';end if;
 dev:=(p_rules->>'development_id')::bigint;
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
 update public.hub_sales_queues set development_id=dev,trigger_qualified=(p_rules->>'trigger_qualified')::boolean,
  trigger_stage_ids=stages,schedule_enabled=(p_rules->>'schedule_enabled')::boolean,weekdays=days,
  starts_at=start_time,ends_at=end_time,priority=(p_rules->>'priority')::integer,
  routing_creation_payload=case when p_id is null then payload else routing_creation_payload end where id=q.id returning * into q;
 update public.hub_sales_queue_members set paused=true where queue_id=q.id and member_id=any(coalesce(paused_members,'{}'));
 insert into public.hub_sales_queue_events(queue_id,id_empresa,actor_id,before_data,after_data)
  values(q.id,p_company_id,private.hub_sales_actor_id(),null,jsonb_build_object('rules',p_rules));
 return q;
end $$;
create function public.hub_save_sales_queue_v2(p_company_id bigint,p_id uuid,p_name text,p_timeout integer,
 p_members uuid[],p_active boolean,p_revision integer,p_request_id uuid,p_rules jsonb)
returns public.hub_sales_queues language sql security invoker set search_path='' as $$
 select private.hub_save_sales_queue_v2(p_company_id,p_id,p_name,p_timeout,p_members,p_active,p_revision,p_request_id,p_rules)
$$;

create function private.hub_pause_queue_member(p_queue uuid,p_member uuid,p_paused boolean) returns void
language plpgsql security definer set search_path='' as $$
declare q public.hub_sales_queues;
begin
 select * into q from public.hub_sales_queues where id=p_queue;
 if not found or not private.hub_sales_manager_native(q.id_empresa) then raise exception 'Acesso restrito' using errcode='42501';end if;
 select * into q from public.hub_sales_queues where id=p_queue for update;
 if p_paused is null then raise exception 'Informe a situação' using errcode='22023';end if;
 update public.hub_sales_queue_members set paused=p_paused where queue_id=q.id and member_id=p_member;
 if not found then raise exception 'Corretor fora da fila' using errcode='22023';end if;
 update public.hub_sales_queues set revision=revision+1 where id=q.id;
 insert into public.hub_sales_queue_events(queue_id,id_empresa,actor_id,before_data,after_data)
 values(q.id,q.id_empresa,private.hub_sales_actor_id(),null,jsonb_build_object('member_id',p_member,'paused',p_paused));
end $$;
create function public.hub_pause_queue_member(p_queue uuid,p_member uuid,p_paused boolean) returns void
language sql security invoker set search_path='' as $$ select private.hub_pause_queue_member(p_queue,p_member,p_paused) $$;

-- Manager-only aggregates: no client truncation masquerading as lifetime totals.
create function private.hub_sales_queue_overview(p_company_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.hub_sales_manager_native(p_company_id) then raise exception 'Acesso restrito' using errcode='42501';end if;
 return jsonb_build_object('installed',true,'pending',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('queue_id',d.queue_id) order by o.expires_at)
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
create function public.hub_sales_queue_overview(p_company_id bigint) returns jsonb language sql security invoker set search_path='' as $$
 select private.hub_sales_queue_overview(p_company_id)
$$;

-- Bounded worker. Same lock order as existing dispatcher: module -> queue -> opportunity -> distribution.
create function private.hub_route_sales_waiting(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare w record;q record;op public.crm_opportunities;d uuid;n integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 1000 then raise exception 'Lote inválido';end if;
 for w in select sw.* from private.hub_sales_waiting sw
  join public.hub_company_modules cm on cm.id_empresa=sw.id_empresa and cm.crm
  where sw.next_attempt_at<=clock_timestamp()
  and not exists(select 1 from public.hub_sales_distributions sd where sd.opportunity_id=sw.opportunity_id and sd.status='pending')
  order by sw.next_attempt_at,sw.created_at limit p_limit loop
  begin
  perform 1 from public.hub_company_modules where id_empresa=w.id_empresa and crm for share skip locked;
  if not found then continue;end if;
  if exists(select 1 from public.crm_opportunities where id=w.opportunity_id and assigned_to is not null) then
   delete from private.hub_sales_waiting where opportunity_id=w.opportunity_id;continue;end if;
  if exists(select 1 from public.hub_sales_distributions where opportunity_id=w.opportunity_id and status='pending') then continue;end if;
  select sq.* into q from public.hub_sales_queues sq where sq.id_empresa=w.id_empresa
   and private.hub_queue_is_open(sq.id) and private.hub_queue_matches(sq.id,w.opportunity_id)
   and exists(select 1 from public.hub_sales_queue_members m join public.crm_users u on u.id=m.member_id and u.id_empresa=m.id_empresa
    where m.queue_id=sq.id and not m.paused and u.active and u.role in ('agent','corretor'))
   order by (sq.development_id is not null) desc,sq.priority,sq.id for update skip locked limit 1;
  if not found then
   update private.hub_sales_waiting set reason='no_available_queue',next_attempt_at=clock_timestamp()+interval '1 minute' where opportunity_id=w.opportunity_id;
   continue;
  end if;
  select * into op from public.crm_opportunities where id=w.opportunity_id and id_empresa=w.id_empresa for update skip locked;
  if not found or op.assigned_to is not null then continue;end if;
  if exists(select 1 from public.hub_sales_distributions where opportunity_id=op.id and status='pending') then continue;end if;
  if not private.hub_queue_matches(q.id,op.id) or not private.hub_queue_is_open(q.id) then continue;end if;
  insert into public.hub_sales_distributions(id_empresa,queue_id,opportunity_id,request_id,origin)
   values(w.id_empresa,q.id,op.id,gen_random_uuid(),'automatic') returning id into d;
  perform private.hub_next_sales_offer_native(d);
  update private.hub_sales_waiting set next_attempt_at=clock_timestamp()+interval '30 minutes',attempts=attempts+1 where opportunity_id=op.id;
  n:=n+1;
  exception when others then
   update private.hub_sales_waiting set reason='processing_error',next_attempt_at=clock_timestamp()+interval '5 minutes',attempts=attempts+1
    where opportunity_id=w.opportunity_id;
  end;
 end loop;
 return n;
end $$;

-- Explicit grants; no new runtime helper is callable from the client.
revoke all on function private.hub_queue_is_open(uuid,timestamptz),private.hub_queue_matches(uuid,uuid),
 private.hub_track_sales_waiting(),private.hub_route_sales_waiting(integer),
 private.hub_save_sales_queue_v2(bigint,uuid,text,integer,uuid[],boolean,integer,uuid,jsonb),
 private.hub_pause_queue_member(uuid,uuid,boolean),private.hub_sales_queue_overview(bigint)
 from public,anon,authenticated,service_role;
revoke all on function public.hub_save_sales_queue_v2(bigint,uuid,text,integer,uuid[],boolean,integer,uuid,jsonb),
 public.hub_pause_queue_member(uuid,uuid,boolean),public.hub_sales_queue_overview(bigint) from public,anon,authenticated,service_role;
grant execute on function private.hub_save_sales_queue_v2(bigint,uuid,text,integer,uuid[],boolean,integer,uuid,jsonb),
 private.hub_pause_queue_member(uuid,uuid,boolean),private.hub_sales_queue_overview(bigint),
 public.hub_save_sales_queue_v2(bigint,uuid,text,integer,uuid[],boolean,integer,uuid,jsonb),
 public.hub_pause_queue_member(uuid,uuid,boolean),public.hub_sales_queue_overview(bigint) to authenticated;
-- Function replacements appended below, inside the same transaction.
CREATE OR REPLACE FUNCTION private.hub_next_sales_offer_native(p_distribution uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.hub_sales_distributions; q public.hub_sales_queues; member record; title_value text;
begin
 select * into d from public.hub_sales_distributions where id=p_distribution;
 if d.status<>'pending' then return; end if;
 select * into q from public.hub_sales_queues where id=d.queue_id;
 if not private.hub_queue_is_open(q.id) then return;end if;
 if exists(select 1 from public.hub_sales_offers where distribution_id=d.id and status='pending') then return;end if;
 select m.member_id,m.position into member from public.hub_sales_queue_members m join public.crm_users u on u.id=m.member_id and u.active and u.role in ('agent','corretor') and u.id_empresa=m.id_empresa
 where m.queue_id=q.id and not m.paused and not exists(select 1 from public.hub_sales_offers o where o.distribution_id=d.id and o.member_id=m.member_id)
 order by (m.position>q.cursor_position) desc,m.position limit 1;
 if not found and not exists(select 1 from public.hub_sales_queue_members m join public.crm_users u on u.id=m.member_id and u.id_empresa=m.id_empresa where m.queue_id=q.id and not m.paused and u.active and u.role in ('agent','corretor')) then return;end if;
 if not found then update public.hub_sales_distributions set status='exhausted',finished_at=clock_timestamp() where id=d.id; return; end if;
 select title into title_value from public.crm_opportunities where id=d.opportunity_id;
 insert into public.hub_sales_offers(id_empresa,distribution_id,member_id,opportunity_title,expires_at) values(d.id_empresa,d.id,member.member_id,title_value,clock_timestamp()+make_interval(mins=>q.timeout_minutes));
 update public.hub_sales_queues set cursor_position=member.position where id=q.id;
end $function$
;
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
 perform private.hub_route_sales_waiting(p_limit);
 insert into private.sales_worker_runs(started_at,finished_at,processed,failed,skipped) values(started,clock_timestamp(),processed,failed,skipped);
 -- Only this worker's operational logs are retained for 30 days; business history is preserved.
 delete from private.sales_worker_runs where started_at<clock_timestamp()-interval '30 days';
 return jsonb_build_object('status','completed','processed',processed,'failed',failed,'skipped',skipped);
end $function$
;
CREATE OR REPLACE FUNCTION private.hub_enqueue_sales_native(p_queue uuid, p_opportunity uuid, p_request_id uuid)
 RETURNS hub_sales_distributions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.crm_users;q public.hub_sales_queues;op public.crm_opportunities;d public.hub_sales_distributions;
begin
 select * into actor from public.crm_users where auth_user_id=auth.uid() and active is true for share;
 select * into q from public.hub_sales_queues where id=p_queue;
 if not found or not private.hub_sales_manager_native(q.id_empresa) then raise exception 'Fila indisponível' using errcode='42501'; end if;
 perform 1 from public.hub_company_modules where id_empresa=q.id_empresa and crm for share;
 if not found then raise exception 'CRM desativado' using errcode='42501'; end if;
 select * into q from public.hub_sales_queues where id=p_queue for update;
 if p_request_id is null then raise exception 'Solicitação obrigatória' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(q.id_empresa::text||p_request_id::text,42));
 select * into d from public.hub_sales_distributions where id_empresa=q.id_empresa and request_id=p_request_id;
 if found then if d.queue_id<>p_queue or d.opportunity_id<>p_opportunity then raise exception 'Solicitação reutilizada' using errcode='22023'; end if; return d; end if;
 if not q.active then raise exception 'Fila pausada' using errcode='22023'; end if;
 select * into op from public.crm_opportunities where id=p_opportunity and id_empresa=q.id_empresa for update;
 if not found then raise exception 'Oportunidade indisponível' using errcode='42501'; end if;
 if q.development_id is not null and not exists(select 1 from public.crm_leads l where l.id=op.lead_id and l.id_empresa=q.id_empresa and l.id_empreendimento=q.development_id) then raise exception 'Empreendimento incompatível com a fila' using errcode='22023';end if;
 if op.assigned_to is not null then raise exception 'A oportunidade já tem responsável' using errcode='PT409'; end if;
 if exists(select 1 from public.hub_sales_distributions where opportunity_id=op.id and status='pending') then raise exception 'Oportunidade já está em distribuição' using errcode='PT409'; end if;
 insert into public.hub_sales_distributions(id_empresa,queue_id,opportunity_id,created_by,request_id) values(q.id_empresa,q.id,op.id,actor.id,p_request_id) returning * into d;
 perform private.hub_next_sales_offer_native(d.id);
 select * into d from public.hub_sales_distributions where id=d.id;
 return d;
end $function$

;
commit;
