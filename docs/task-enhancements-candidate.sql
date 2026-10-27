-- Task types, calendar sorting and optional secretary reminders. Apply before frontend.
begin;
alter table public.crm_lead_tasks
 add column tipo text not null default 'outro' check(tipo in ('ligacao','whatsapp','visita','reuniao','follow_up','outro')),
 add column reminder_minutes integer check(reminder_minutes in (5,15,30,60,1440)),
 add column priority_rank integer generated always as (case prioridade when 'alta' then 0 when 'normal' then 1 else 2 end) stored;
create index task_company_due on public.crm_lead_tasks(id_empresa,prazo,priority_rank,id);
create index task_company_priority on public.crm_lead_tasks(id_empresa,priority_rank,prazo,id);

create table private.hub_task_reminders (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null unique references public.crm_lead_tasks(id) on delete cascade,
 id_empresa bigint not null references public.empresa_dados(id),
 member_id uuid not null references public.crm_users(id),
 due_at timestamptz not null, available_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','cancelled','failed','uncertain')),
 attempts integer not null default 0,lease uuid,claimed_at timestamptz,provider_id text,reason text,
 updated_at timestamptz not null default now()
);
alter table private.hub_task_reminders enable row level security;
revoke all on private.hub_task_reminders from public,anon,authenticated;
grant all on private.hub_task_reminders to service_role;
create policy task_reminders_service on private.hub_task_reminders to service_role using(true) with check(true);
create index task_reminders_due on private.hub_task_reminders(id_empresa,available_at) where status in ('pending','sending');

create function private.hub_task_reminder_ready(p_company bigint,p_member uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hub_whatsapp_channels c
 join private.hub_whatsapp_recipients r on r.id_empresa=c.id_empresa
 join public.crm_users u on u.id=r.member_id and u.id_empresa=c.id_empresa
 join public.hub_company_modules m on m.id_empresa=c.id_empresa
 join private.hub_whatsapp_transport t on t.id_empresa=c.id_empresa
 where c.id_empresa=p_company and r.member_id=p_member and c.enabled and c.auto_send and c.inbound_verified_at is not null
 and r.enabled and nullif(r.phone,'') is not null and u.active and u.role in ('manager','gestor','agent','corretor') and m.crm
 and t.worker_secret is not null and t.api_key_secret is not null
 and exists(select 1 from private.hub_secretary_endpoints where singleton))
$$;
create function private.hub_task_reminder_options(p_company_id bigint) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('member_id',u.id,'ready',private.hub_task_reminder_ready(p_company_id,u.id))),'[]'::jsonb)
 from public.crm_users u where u.id_empresa=p_company_id and u.active and u.role in ('manager','gestor','agent','corretor')
 and private.hub_sales_module_enabled(p_company_id) and exists(select 1 from public.crm_users a where a.auth_user_id=auth.uid() and a.active
 and (a.role='super_admin' or (a.id_empresa=p_company_id and (a.role in ('manager','gestor') or a.id=u.id))))
$$;
create function public.hub_task_reminder_options(p_company_id bigint) returns jsonb language sql stable security invoker set search_path='' as $$ select private.hub_task_reminder_options(p_company_id) $$;
revoke all on function private.hub_task_reminder_ready(bigint,uuid),private.hub_task_reminder_options(bigint),public.hub_task_reminder_options(bigint) from public,anon;
grant execute on function private.hub_task_reminder_options(bigint),public.hub_task_reminder_options(bigint) to authenticated;

create function private.hub_sync_task_reminder() returns trigger language plpgsql security definer set search_path='' as $$
declare j private.hub_task_reminders; schedule_changed boolean;
begin
 select * into j from private.hub_task_reminders where task_id=new.id for update;
 if j.status='sending' and j.claimed_at>clock_timestamp()-interval '2 minutes' then
  raise exception 'Lembrete em envio. Aguarde alguns instantes e tente salvar novamente.' using errcode='PT409';
 end if;
 if new.reminder_minutes is null or new.status not in ('pendente','em_andamento','vencida') then
  update private.hub_task_reminders set status='cancelled',lease=null,reason='task_closed_or_disabled',updated_at=clock_timestamp() where task_id=new.id and status<>'sent';return new;
 end if;
 schedule_changed:=tg_op='INSERT';
 if tg_op='UPDATE' then
  schedule_changed:=row(new.prazo,new.assigned_to,new.reminder_minutes) is distinct from row(old.prazo,old.assigned_to,old.reminder_minutes)
   or (old.status in ('concluida','cancelada') and new.status not in ('concluida','cancelada'));
 end if;
 if j.id is null or schedule_changed then
  insert into private.hub_task_reminders(task_id,id_empresa,member_id,due_at,available_at)
  values(new.id,new.id_empresa,new.assigned_to,new.prazo,new.prazo-make_interval(mins=>new.reminder_minutes))
  on conflict(task_id) do update set member_id=excluded.member_id,due_at=excluded.due_at,available_at=excluded.available_at,
   status='pending',attempts=0,lease=null,claimed_at=null,provider_id=null,reason=null,updated_at=clock_timestamp();
 end if;
 return new;
end $$;
revoke all on function private.hub_sync_task_reminder() from public,anon,authenticated;
create trigger hub_sync_task_reminder after insert or update on public.crm_lead_tasks for each row execute function private.hub_sync_task_reminder();

CREATE OR REPLACE FUNCTION private.hub_guard_task_direct_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if current_user in ('authenticated','anon') then
  if tg_op='INSERT' then
   if new.tipo<>'outro' or new.reminder_minutes is not null or new.opportunity_id is not null or new.request_id is not null or new.creation_payload is not null or new.source_offer_id is not null or new.initial_due_at is not null or new.revision is distinct from 1 then
    raise exception 'Use a API de tarefas para campos comerciais' using errcode='42501';end if;
  else
   if old.opportunity_id is not null or old.request_id is not null or old.source_offer_id is not null then
    raise exception 'Use a API de tarefas para alterar tarefas comerciais' using errcode='42501';end if;
   if tg_op='UPDATE' then
    if row(new.tipo,new.reminder_minutes) is distinct from row(old.tipo,old.reminder_minutes) then raise exception 'Use a API de tarefas' using errcode='42501';end if;
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
CREATE OR REPLACE FUNCTION private.hub_save_task_v2_native(p_company_id bigint, p_task_id uuid, p_lead_id bigint, p_opportunity_id uuid, p_title text, p_description text, p_priority text, p_due_at timestamp with time zone, p_assigned_to uuid, p_status text, p_expected_revision integer, p_request_id uuid, p_type text, p_reminder_minutes integer)
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
 if p_type is null or p_type not in ('ligacao','whatsapp','visita','reuniao','follow_up','outro') or (p_reminder_minutes is not null and p_reminder_minutes not in (5,15,30,60,1440)) then raise exception 'Tipo ou antecedência inválidos' using errcode='22023';end if;
 payload:=jsonb_build_object('lead',p_lead_id,'opportunity',p_opportunity_id,'title',btrim(p_title),'description',nullif(btrim(p_description),''),'priority',p_priority,'due',p_due_at,'assignee',p_assigned_to,'actor',actor.id,'type',p_type,'reminder',p_reminder_minutes);
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
 if p_reminder_minutes is not null and p_status in ('pendente','em_andamento') and
 (p_task_id is null or p_reminder_minutes is distinct from old_row.reminder_minutes or p_due_at is distinct from old_row.prazo or p_assigned_to is distinct from old_row.assigned_to or old_row.status in ('concluida','cancelada')) then
  if p_due_at<=clock_timestamp() then raise exception 'O lembrete exige um prazo futuro' using errcode='22023';end if;
  if not private.hub_task_reminder_ready(p_company_id,p_assigned_to) then raise exception 'Configure a Secretária e o WhatsApp do responsável antes de ativar o lembrete' using errcode='22023';end if;
 end if;
 if p_task_id is null then
  insert into public.crm_lead_tasks(id_empresa,lead_id,opportunity_id,titulo,descricao,prioridade,prazo,assigned_to,created_by,request_id,creation_payload,tipo,reminder_minutes)
  values(p_company_id,p_lead_id,p_opportunity_id,btrim(p_title),nullif(btrim(p_description),''),p_priority::public.crm_task_priority,p_due_at,p_assigned_to,actor.id,p_request_id,payload,p_type,p_reminder_minutes) returning * into new_row;
 else
  update public.crm_lead_tasks set titulo=btrim(p_title),descricao=nullif(btrim(p_description),''),prioridade=p_priority::public.crm_task_priority,prazo=p_due_at,
   tipo=p_type,reminder_minutes=p_reminder_minutes,assigned_to=p_assigned_to,status=p_status::public.crm_task_status,completed_at=case when p_status='concluida' then coalesce(old_row.completed_at,now()) else null end,revision=revision+1,updated_at=now()
  where id=p_task_id returning * into new_row;
 end if;
 insert into public.hub_task_events(task_id,id_empresa,actor_id,actor_name,kind,before_data,after_data)
 values(new_row.id,p_company_id,actor.id,actor.nome,case when p_task_id is null then 'created' else 'updated' end,case when p_task_id is null then null else private.hub_task_projection(old_row) end,private.hub_task_projection(new_row));
 return private.hub_task_projection(new_row);
end $function$
;

create function public.hub_save_task_v2(p_company_id bigint,p_task_id uuid,p_lead_id bigint,p_opportunity_id uuid,p_title text,p_description text,p_priority text,p_due_at timestamptz,p_assigned_to uuid,p_status text,p_expected_revision integer,p_request_id uuid,p_type text,p_reminder_minutes integer)
returns jsonb language sql security invoker set search_path='' as $$
 select private.hub_save_task_v2_native(p_company_id,p_task_id,p_lead_id,p_opportunity_id,p_title,p_description,p_priority,p_due_at,p_assigned_to,p_status,p_expected_revision,p_request_id,p_type,p_reminder_minutes)
$$;
revoke all on function public.hub_save_task_v2(bigint,uuid,bigint,uuid,text,text,text,timestamptz,uuid,text,integer,uuid,text,integer),private.hub_save_task_v2_native(bigint,uuid,bigint,uuid,text,text,text,timestamptz,uuid,text,integer,uuid,text,integer) from public,anon;
grant execute on function public.hub_save_task_v2(bigint,uuid,bigint,uuid,text,text,text,timestamptz,uuid,text,integer,uuid,text,integer),private.hub_save_task_v2_native(bigint,uuid,bigint,uuid,text,text,text,timestamptz,uuid,text,integer,uuid,text,integer) to authenticated;

create function private.hub_claim_task_reminder(p_instance text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record;t public.crm_lead_tasks;j private.hub_task_reminders;target text;contact_name text;
begin
 update private.hub_task_reminders r set status='uncertain',reason='worker_interrupted',updated_at=clock_timestamp()
 from public.hub_whatsapp_channels c where c.id_empresa=r.id_empresa and c.instance=p_instance and r.status='sending' and r.claimed_at<clock_timestamp()-interval '2 minutes';
 for candidate in select r.id,r.task_id from private.hub_task_reminders r join public.hub_whatsapp_channels c on c.id_empresa=r.id_empresa
  where c.instance=p_instance and r.status='pending' and r.available_at<=clock_timestamp() order by r.available_at,r.id limit 50 loop
  -- Same lock order as task editing: task first, then its outbox row.
  select * into t from public.crm_lead_tasks where id=candidate.task_id for update skip locked;
  if not found then continue;end if;
  select * into j from private.hub_task_reminders where id=candidate.id for update skip locked;
  if not found or j.status<>'pending' or j.available_at>clock_timestamp() then continue;end if;
  if t.reminder_minutes is null or t.status not in ('pendente','em_andamento','vencida') or t.prazo<=clock_timestamp()
   or row(t.id_empresa,t.assigned_to,t.prazo) is distinct from row(j.id_empresa,j.member_id,j.due_at)
   or not private.hub_task_reminder_ready(t.id_empresa,t.assigned_to)
   or not exists(select 1 from public.crm_users u where u.id=t.assigned_to and u.id_empresa=t.id_empresa and u.active and
    (u.role in ('manager','gestor') or (u.role in ('agent','corretor') and
      ((t.opportunity_id is not null and exists(select 1 from public.crm_opportunities o where o.id=t.opportunity_id and o.id_empresa=t.id_empresa and o.lead_id=t.lead_id and o.assigned_to=u.id))
       or (t.opportunity_id is null and (exists(select 1 from public.crm_leads l where l.id=t.lead_id and l.id_empresa=t.id_empresa and l.crm_assigned_to=u.id)
        or exists(select 1 from public.crm_opportunities o where o.lead_id=t.lead_id and o.id_empresa=t.id_empresa and o.assigned_to=u.id))))))) then
   update private.hub_task_reminders set status='cancelled',reason='task_or_recipient_unavailable',updated_at=clock_timestamp() where id=j.id;continue;
  end if;
  select phone into target from private.hub_whatsapp_recipients where id_empresa=t.id_empresa and member_id=t.assigned_to and enabled;
  select nome into contact_name from public.crm_leads where id=t.lead_id and id_empresa=t.id_empresa;
  update private.hub_task_reminders set status='sending',attempts=attempts+1,lease=gen_random_uuid(),claimed_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.id returning * into j;
  return jsonb_build_object('id',j.id,'lease',j.lease,'phone',target,'instance',p_instance,'body',
    'Lembrete de tarefa: '||t.titulo||E'\nLead: '||coalesce(contact_name,'Lead')||E'\nHorário: '||to_char(t.prazo at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' (Brasília)'||E'\nAbra suas tarefas: https://hub.katsuki.com.br/tarefas');
 end loop;
 return null;
end $$;

create function private.hub_finish_task_reminder(p_id uuid,p_lease uuid,p_status text,p_provider_id text) returns void
language plpgsql security definer set search_path='' as $$
declare j private.hub_task_reminders;
begin
 if p_status is null or p_status not in ('sent','rate_limited','failed','uncertain') then raise exception 'Invalid status' using errcode='22023';end if;
 if p_status='sent' and (p_provider_id is null or length(p_provider_id) not between 1 and 200) then raise exception 'Provider ID required' using errcode='22023';end if;
 select * into j from private.hub_task_reminders where id=p_id for update;
 if not found or p_lease is null or j.lease is distinct from p_lease or j.status<>'sending' then return;end if;
 update private.hub_task_reminders set status=case when p_status='rate_limited' then case when attempts<4 then 'pending' else 'failed' end else p_status end,
  provider_id=case when p_status='sent' then p_provider_id else null end,reason=case when p_status='sent' then null else p_status end,
  available_at=clock_timestamp()+make_interval(secs=>60*j.attempts),updated_at=clock_timestamp() where id=j.id;
end $$;
revoke all on function private.hub_claim_task_reminder(text),private.hub_finish_task_reminder(uuid,uuid,text,text) from public,anon,authenticated;

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
 return private.hub_claim_task_reminder(p_instance);
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
  if exists(select 1 from private.hub_task_reminders where id=(p_args->>'p_id')::uuid and id_empresa=(config->>'company')::bigint) then
   perform private.hub_finish_task_reminder((p_args->>'p_id')::uuid,(p_args->>'p_lease')::uuid,p_args->>'p_status',p_args->>'p_provider_id');
   return '{}'::jsonb;
  end if;
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
 and (exists(select 1 from public.hub_whatsapp_outbox o where o.id_empresa=ch.id_empresa and ((o.status='pending' and o.available_at<=clock_timestamp()) or (o.status='sending' and o.claimed_at<clock_timestamp()-interval '2 minutes')))
 or exists(select 1 from private.hub_task_reminders r where r.id_empresa=ch.id_empresa and ((r.status='pending' and r.available_at<=clock_timestamp()) or (r.status='sending' and r.claimed_at<clock_timestamp()-interval '2 minutes'))))
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

-- Task-only scheduler; the offer dispatcher retains its existing behavior.
create function private.hub_dispatch_due_task_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare c record;total integer:=0;
begin
 for c in select distinct r.id_empresa from private.hub_task_reminders r join public.hub_whatsapp_channels ch on ch.id_empresa=r.id_empresa
 where ch.enabled and ch.auto_send and ch.inbound_verified_at is not null and
 ((r.status='pending' and r.available_at<=clock_timestamp()) or (r.status='sending' and r.claimed_at<clock_timestamp()-interval '2 minutes')) limit 20 loop
  total:=total+private.hub_dispatch_secretary(c.id_empresa);
 end loop;
 return total;
end $$;
revoke all on function private.hub_dispatch_due_task_reminders() from public,anon,authenticated;
commit;
