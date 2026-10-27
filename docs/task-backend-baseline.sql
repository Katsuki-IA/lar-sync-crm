CREATE OR REPLACE FUNCTION private.hub_claim_whatsapp(p_instance text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job public.hub_whatsapp_outbox; n public.hub_secretary_notices; target text;
begin
 update public.hub_whatsapp_outbox o set status='uncertain',reason='worker_interrupted',updated_at=clock_timestamp()
 from public.hub_whatsapp_channels c where c.id_empresa=o.id_empresa and c.instance=p_instance and o.status='sending' and o.claimed_at<clock_timestamp()-interval '2 minutes';
 for job in select o.* from public.hub_whatsapp_outbox o join public.hub_whatsapp_channels c on c.id_empresa=o.id_empresa
 where c.instance=p_instance and o.status='pending' and o.available_at<=clock_timestamp()
 order by o.available_at,o.id limit 50 for update of o skip locked loop
  select * into n from public.hub_secretary_notices where id=job.notice_id;
  select r.phone into target from private.hub_whatsapp_recipients r
  join public.hub_whatsapp_channels c on c.id_empresa=r.id_empresa and c.enabled
  join public.crm_users u on u.id=r.member_id and u.id_empresa=r.id_empresa and u.active and u.role in ('agent','corretor')
  join public.hub_company_modules m on m.id_empresa=r.id_empresa and m.crm
  where r.id_empresa=job.id_empresa and r.member_id=job.member_id and r.enabled;
  if target is null or not exists(
   select 1 from public.hub_sales_offers o join public.hub_sales_distributions d on d.id=o.distribution_id
   join public.hub_sales_queues q on q.id=d.queue_id join public.crm_opportunities p on p.id=d.opportunity_id
   where o.id=n.offer_id and o.status='pending' and o.expires_at>clock_timestamp()+interval '15 seconds'
    and d.status='pending' and q.active and p.assigned_to is null
  ) then
   update public.hub_whatsapp_outbox set status='cancelled',reason='offer_or_recipient_unavailable',updated_at=clock_timestamp() where id=job.id;
   continue;
  end if;
  update public.hub_whatsapp_outbox set status='sending',attempts=attempts+1,lease=gen_random_uuid(),claimed_at=clock_timestamp(),updated_at=clock_timestamp() where id=job.id returning * into job;
  return jsonb_build_object('id',job.id,'lease',job.lease,'phone',target,'body',n.body,'instance',p_instance);
 end loop;
 return null;
end $function$
;

CREATE OR REPLACE FUNCTION private.hub_dispatch_secretary(p_company_id bigint DEFAULT NULL::bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c record;rid bigint;total integer:=0;endpoint text;
begin
 select base_url||'/hub-secretary-worker' into endpoint from private.hub_secretary_endpoints where singleton;
 if endpoint is null then raise exception 'Destino da secretária não configurado' using errcode='22023';end if;
 if not pg_try_advisory_xact_lock(739252,4173) then return 0;end if;
 for c in select ch.id_empresa,s.decrypted_secret from public.hub_whatsapp_channels ch join private.hub_whatsapp_transport t using(id_empresa)
 join vault.decrypted_secrets s on s.id=t.worker_secret join public.hub_company_modules m on m.id_empresa=ch.id_empresa and m.crm
 where ch.enabled and ((p_company_id is null and ch.auto_send and ch.inbound_verified_at is not null) or ch.id_empresa=p_company_id)
 and (ch.last_dispatch_at is null or ch.last_dispatch_at<clock_timestamp()-interval '45 seconds')
 and exists(select 1 from public.hub_whatsapp_outbox o where o.id_empresa=ch.id_empresa and ((o.status='pending' and o.available_at<=clock_timestamp()) or (o.status='sending' and o.claimed_at<clock_timestamp()-interval '2 minutes')))
 order by ch.last_dispatch_at nulls first limit 20 for update of ch skip locked loop
 rid:=net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-hub-secret',c.decrypted_secret),body:='{}'::jsonb,timeout_milliseconds:=30000);
 insert into private.hub_whatsapp_dispatch_runs(id_empresa,request_id) values(c.id_empresa,rid);
 update public.hub_whatsapp_channels set last_dispatch_at=clock_timestamp() where id_empresa=c.id_empresa;
 total:=total+1;
 end loop;
 delete from private.hub_whatsapp_dispatch_runs where created_at<clock_timestamp()-interval '30 days';
 return total;
end $function$
;

CREATE OR REPLACE FUNCTION private.hub_finish_whatsapp(p_id uuid, p_lease uuid, p_status text, p_provider_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job public.hub_whatsapp_outbox;
begin
 if p_status not in('sent','rate_limited','failed','uncertain') or p_status is null then raise exception 'Invalid status' using errcode='22023'; end if;
 if p_status='sent' and (p_provider_id is null or length(p_provider_id) not between 1 and 200) then raise exception 'Provider ID required' using errcode='22023'; end if;
 select * into job from public.hub_whatsapp_outbox where id=p_id for update;
 if not found or job.lease is distinct from p_lease or job.status<>'sending' then return; end if;
 update public.hub_whatsapp_outbox set
 status=case when p_status='rate_limited' then case when attempts<4 then 'pending' else 'failed' end else p_status end,
 provider_id=case when p_status='sent' then p_provider_id else null end,
 reason=case when p_status='sent' then null else p_status end,
 available_at=clock_timestamp()+make_interval(secs=>60*job.attempts),updated_at=clock_timestamp()
 where id=job.id;
end $function$
;

CREATE OR REPLACE FUNCTION private.hub_guard_task_direct_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if current_user in ('authenticated','anon') then
  if tg_op='INSERT' then
   if new.opportunity_id is not null or new.request_id is not null or new.creation_payload is not null or new.source_offer_id is not null or new.initial_due_at is not null or new.revision is distinct from 1 then
    raise exception 'Use a API de tarefas para campos comerciais' using errcode='42501';end if;
  else
   if old.opportunity_id is not null or old.request_id is not null or old.source_offer_id is not null then
    raise exception 'Use a API de tarefas para alterar tarefas comerciais' using errcode='42501';end if;
   if tg_op='UPDATE' then
    if row(new.opportunity_id,new.request_id,new.creation_payload,new.source_offer_id,new.initial_due_at,new.revision)
      is distinct from row(old.opportunity_id,old.request_id,old.creation_payload,old.source_offer_id,old.initial_due_at,old.revision) then
     raise exception 'Use a API de tarefas para campos comerciais' using errcode='42501';end if;
    new.revision:=old.revision+1;
   end if;
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.hub_save_task_native(p_company_id bigint, p_task_id uuid, p_lead_id bigint, p_opportunity_id uuid, p_title text, p_description text, p_priority text, p_due_at timestamp with time zone, p_assigned_to uuid, p_status text, p_expected_revision integer, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.crm_users; assignee public.crm_users; old_row public.crm_lead_tasks; new_row public.crm_lead_tasks; contact public.crm_leads; op public.crm_opportunities; payload jsonb;
begin
 select * into actor from public.crm_users where auth_user_id=auth.uid() and active is true for share;
 actor.role:=case actor.role when 'gestor' then 'manager' when 'corretor' then 'agent' else actor.role end;
 if auth.uid() is null or actor.id is null or actor.role not in ('super_admin','manager','agent') or (actor.role<>'super_admin' and actor.id_empresa is distinct from p_company_id) then raise exception 'Acesso negado às tarefas' using errcode='42501'; end if;
 perform 1 from public.hub_company_modules where id_empresa=p_company_id and crm for share;
 if not found then raise exception 'CRM não habilitado' using errcode='42501'; end if;
 if p_title is null or length(btrim(p_title)) not between 2 and 200 or length(p_description)>4000 or p_due_at is null or not isfinite(p_due_at)
 or p_priority is null or p_priority not in ('baixa','normal','alta') or p_status is null or p_status not in ('pendente','em_andamento','concluida','cancelada') or p_assigned_to is null then raise exception 'Informe título, prazo, prioridade, responsável e situação válidos' using errcode='22023'; end if;
 select * into contact from public.crm_leads where id=p_lead_id and id_empresa=p_company_id for share;
 if not found then raise exception 'Contato indisponível nesta empresa' using errcode='42501'; end if;
 if p_opportunity_id is not null then
  select * into op from public.crm_opportunities where id=p_opportunity_id and id_empresa=p_company_id and lead_id=p_lead_id for share;
  if not found then raise exception 'Oportunidade não corresponde ao contato' using errcode='42501'; end if;
 end if;
 if actor.role in ('agent','corretor') and (p_assigned_to<>actor.id or not private.hub_task_visible(p_company_id,p_lead_id,p_opportunity_id,actor.id)) then raise exception 'Corretor gerencia apenas tarefas próprias em contatos e oportunidades acessíveis' using errcode='42501'; end if;
 payload:=jsonb_build_object('lead',p_lead_id,'opportunity',p_opportunity_id,'title',btrim(p_title),'description',nullif(btrim(p_description),''),'priority',p_priority,'due',p_due_at,'assignee',p_assigned_to,'actor',actor.id);
 if p_task_id is null then
  if p_request_id is null or p_status<>'pendente' then raise exception 'Nova tarefa deve iniciar pendente e possuir identificação' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('task:'||p_company_id||':'||p_request_id,0));
  select * into old_row from public.crm_lead_tasks where id_empresa=p_company_id and request_id=p_request_id;
  if found then
   if old_row.creation_payload is distinct from payload then raise exception 'Solicitação já utilizada com outros dados' using errcode='22023'; end if;
   if not private.hub_task_visible(old_row.id_empresa,old_row.lead_id,old_row.opportunity_id,old_row.assigned_to) then raise exception 'Tarefa não acessível' using errcode='42501'; end if;
   return private.hub_task_projection(old_row);
  end if;
 else
  select * into old_row from public.crm_lead_tasks where id=p_task_id and id_empresa=p_company_id for update;
  if old_row.id is null or not private.hub_task_visible(old_row.id_empresa,old_row.lead_id,old_row.opportunity_id,old_row.assigned_to) then raise exception 'Tarefa não acessível' using errcode='42501'; end if;
  if old_row.lead_id is distinct from p_lead_id or old_row.opportunity_id is distinct from p_opportunity_id then raise exception 'O contexto da tarefa não pode ser trocado' using errcode='42501'; end if;
  if old_row.revision is distinct from p_expected_revision then raise exception 'Tarefa alterada por outra sessão. Feche e reabra para atualizar.' using errcode='PT409'; end if;
 end if;
 -- An unchanged historical assignee may be suspended; managers can still cancel/complete that task.
 if p_task_id is null or p_assigned_to is distinct from old_row.assigned_to then
  select * into assignee from public.crm_users where id=p_assigned_to and id_empresa=p_company_id and active is true and role in ('manager','agent','gestor','corretor') for share;
  if not found then raise exception 'Responsável inativo ou de outra empresa' using errcode='42501'; end if;
  if assignee.role in ('agent','corretor') and ((p_opportunity_id is not null and op.assigned_to is distinct from assignee.id) or
   (p_opportunity_id is null and contact.crm_assigned_to is distinct from assignee.id and not exists(select 1 from public.crm_opportunities where lead_id=p_lead_id and id_empresa=p_company_id and assigned_to=assignee.id))) then raise exception 'Responsável não possui acesso ao contexto da tarefa' using errcode='42501'; end if;
 end if;
 if p_task_id is null then
  insert into public.crm_lead_tasks(id_empresa,lead_id,opportunity_id,titulo,descricao,prioridade,prazo,assigned_to,created_by,request_id,creation_payload)
  values(p_company_id,p_lead_id,p_opportunity_id,btrim(p_title),nullif(btrim(p_description),''),p_priority::public.crm_task_priority,p_due_at,p_assigned_to,actor.id,p_request_id,payload) returning * into new_row;
 else
  update public.crm_lead_tasks set titulo=btrim(p_title),descricao=nullif(btrim(p_description),''),prioridade=p_priority::public.crm_task_priority,prazo=p_due_at,
   assigned_to=p_assigned_to,status=p_status::public.crm_task_status,completed_at=case when p_status='concluida' then coalesce(old_row.completed_at,now()) else null end,revision=revision+1,updated_at=now()
  where id=p_task_id returning * into new_row;
 end if;
 insert into public.hub_task_events(task_id,id_empresa,actor_id,actor_name,kind,before_data,after_data)
 values(new_row.id,p_company_id,actor.id,actor.nome,case when p_task_id is null then 'created' else 'updated' end,case when p_task_id is null then null else private.hub_task_projection(old_row) end,private.hub_task_projection(new_row));
 return private.hub_task_projection(new_row);
end $function$
;

CREATE OR REPLACE FUNCTION private.hub_secretary_call(p_kind text, p_token text, p_operation text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare config jsonb;
begin
 config:=private.hub_secretary_runtime(p_kind,p_token);
 if config is null then raise exception 'Unauthorized' using errcode='42501';end if;
 if p_kind='worker' and p_operation='claim' then
  return private.hub_claim_whatsapp(config->>'instance');
 elsif p_kind='worker' and p_operation='finish' then
  if not exists(select 1 from public.hub_whatsapp_outbox where id=(p_args->>'p_id')::uuid and id_empresa=(config->>'company')::bigint) then
   raise exception 'Unavailable message' using errcode='42501';end if;
  perform private.hub_finish_whatsapp((p_args->>'p_id')::uuid,(p_args->>'p_lease')::uuid,p_args->>'p_status',p_args->>'p_provider_id');
  return '{}'::jsonb;
 elsif p_kind='webhook' and p_operation='receive' then
  return private.hub_receive_whatsapp(config->>'instance',p_args->>'p_phone',p_args->>'p_event_id',p_args->>'p_body');
 end if;
 raise exception 'Invalid operation' using errcode='42501';
end $function$
;

CREATE OR REPLACE FUNCTION private.hub_task_projection(t crm_lead_tasks)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select to_jsonb(t)-'creation_payload'-'request_id' $function$
;
