CREATE OR REPLACE FUNCTION private.hub_advance_sales_distribution_locked(p_id uuid, p_cancel boolean)
 RETURNS hub_sales_distributions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.hub_sales_distributions;o public.hub_sales_offers;unavailable boolean;
begin
 select * into d from public.hub_sales_distributions where id=p_id for update;
 if not found or d.status<>'pending' then return d; end if;
 select * into o from public.hub_sales_offers where distribution_id=d.id and status='pending' for update;
 if p_cancel or exists(select 1 from public.crm_opportunities where id=d.opportunity_id and assigned_to is not null) then
  update public.hub_sales_offers set status='cancelled',resolved_at=clock_timestamp() where id=o.id;
  update public.hub_sales_distributions set status='cancelled',finished_at=clock_timestamp() where id=d.id;
 else
  unavailable:=not exists(select 1 from public.crm_users where id=o.member_id and active and role in ('agent','corretor') and id_empresa=d.id_empresa);
  if o.id is null or unavailable or o.expires_at<=clock_timestamp() then
   update public.hub_sales_offers set status=case when unavailable then 'unavailable' else 'expired' end,resolved_at=clock_timestamp() where id=o.id;
   perform private.hub_next_sales_offer_native(d.id);
  end if;
 end if;
 select * into d from public.hub_sales_distributions where id=p_id;
 return d;
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
 if op.assigned_to is not null then raise exception 'A oportunidade já tem responsável' using errcode='PT409'; end if;
 if exists(select 1 from public.hub_sales_distributions where opportunity_id=op.id and status='pending') then raise exception 'Oportunidade já está em distribuição' using errcode='PT409'; end if;
 insert into public.hub_sales_distributions(id_empresa,queue_id,opportunity_id,created_by,request_id) values(q.id_empresa,q.id,op.id,actor.id,p_request_id) returning * into d;
 perform private.hub_next_sales_offer_native(d.id);
 select * into d from public.hub_sales_distributions where id=d.id;
 return d;
end $function$
;
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
 select m.member_id,m.position into member from public.hub_sales_queue_members m join public.crm_users u on u.id=m.member_id and u.active and u.role in ('agent','corretor') and u.id_empresa=m.id_empresa
 where m.queue_id=q.id and not exists(select 1 from public.hub_sales_offers o where o.distribution_id=d.id and o.member_id=m.member_id)
 order by (m.position>q.cursor_position) desc,m.position limit 1;
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
   and (o.id is null or o.expires_at<=clock_timestamp() or u.active is distinct from true or u.role not in ('agent','corretor') or op.assigned_to is not null)
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
 insert into private.sales_worker_runs(started_at,finished_at,processed,failed,skipped) values(started,clock_timestamp(),processed,failed,skipped);
 -- Only this worker's operational logs are retained for 30 days; business history is preserved.
 delete from private.sales_worker_runs where started_at<clock_timestamp()-interval '30 days';
 return jsonb_build_object('status','completed','processed',processed,'failed',failed,'skipped',skipped);
end $function$
;
CREATE OR REPLACE FUNCTION private.hub_sales_manager_native(company_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select private.hub_sales_module_enabled(company_id) and exists(select 1 from public.crm_users u
 where u.auth_user_id=auth.uid() and u.active is true and (u.role='super_admin' or (u.id_empresa=company_id and u.role in ('manager','gestor'))))
$function$
;
CREATE OR REPLACE FUNCTION private.hub_save_sales_queue_native(p_company_id bigint, p_id uuid, p_name text, p_timeout integer, p_members uuid[], p_active boolean, p_revision integer, p_request_id uuid)
 RETURNS hub_sales_queues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.crm_users; q public.hub_sales_queues; before_config jsonb; payload jsonb;
begin
 select * into actor from public.crm_users where auth_user_id=auth.uid() and active is true for share;
 if not private.hub_sales_manager_native(p_company_id) then raise exception 'Somente gestores podem configurar filas' using errcode='42501'; end if;
 perform 1 from public.hub_company_modules where id_empresa=p_company_id and crm for share;
 if not found then raise exception 'CRM desativado' using errcode='42501'; end if;
 if p_name is null or length(btrim(p_name)) not between 2 and 100 or p_timeout is null or p_timeout not between 1 and 1440 or p_active is null
 or p_members is null or cardinality(p_members) not between 1 and 100 or cardinality(p_members)<>(select count(distinct x) from unnest(p_members) x) then raise exception 'Informe nome, prazo e participantes únicos' using errcode='22023'; end if;
 -- Queue membership is managed without holding recipient profile locks; eligibility is rechecked on dispatch and acceptance.
 if exists(select 1 from unnest(p_members) x where not exists(select 1 from public.crm_users u where u.id=x and u.id_empresa=p_company_id and u.active and u.role in ('agent','corretor'))) then raise exception 'Escolha corretores ativos da empresa' using errcode='22023'; end if;
 payload:=jsonb_build_object('name',btrim(p_name),'timeout',p_timeout,'members',p_members,'active',p_active);
 if p_id is null then
  if p_request_id is null then raise exception 'Solicitação obrigatória' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||p_request_id::text,41));
  select * into q from public.hub_sales_queues where id_empresa=p_company_id and request_id=p_request_id;
  if found then if q.creation_payload<>payload then raise exception 'Solicitação reutilizada com outros dados' using errcode='22023'; end if; return q; end if;
  insert into public.hub_sales_queues(id_empresa,name,timeout_minutes,active,request_id,creation_payload) values(p_company_id,btrim(p_name),p_timeout,p_active,p_request_id,payload) returning * into q;
 else
  select * into q from public.hub_sales_queues where id=p_id and id_empresa=p_company_id for update;
  if not found then raise exception 'Fila indisponível' using errcode='42501'; end if;
  if q.revision is distinct from p_revision then raise exception 'Fila alterada. Atualize a página.' using errcode='PT409'; end if;
  if exists(select 1 from public.hub_sales_distributions where queue_id=q.id and status='pending') then raise exception 'Conclua ou cancele as distribuições abertas antes de editar a fila' using errcode='PT409'; end if;
  before_config:=to_jsonb(q)-'creation_payload';
  before_config:=before_config||jsonb_build_object('members',(select jsonb_agg(member_id order by position) from public.hub_sales_queue_members where queue_id=q.id));
  update public.hub_sales_queues set name=btrim(p_name),timeout_minutes=p_timeout,active=p_active,revision=revision+1,cursor_position=0 where id=q.id returning * into q;
  delete from public.hub_sales_queue_members where queue_id=q.id;
 end if;
 insert into public.hub_sales_queue_members(queue_id,id_empresa,member_id,position) select q.id,p_company_id,x,ord from unnest(p_members) with ordinality m(x,ord);
 insert into public.hub_sales_queue_events(queue_id,id_empresa,actor_id,before_data,after_data) values(q.id,p_company_id,actor.id,before_config,(to_jsonb(q)-'creation_payload')||jsonb_build_object('members',p_members));
 return q;
end $function$
;
