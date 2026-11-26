-- Explicit per-company enrollment for a global administrator's own task reminders.
create table private.hub_personal_task_recipients (
 id_empresa bigint not null references public.empresa_dados(id),
 member_id uuid not null references public.crm_users(id),
 phone text check (phone ~ '^[1-9][0-9]{9,14}$'),
 enabled boolean not null default false check (not enabled or phone is not null),
 primary key(id_empresa,member_id)
);
alter table private.hub_personal_task_recipients enable row level security;
revoke all on private.hub_personal_task_recipients from public,anon,authenticated;
insert into private.hub_personal_task_recipients(id_empresa,member_id)
select e.id,u.id from public.empresa_dados e cross join public.crm_users u
where e.nome='Katsuki Prospecção 1' and u.nome='Ana Katsuki' and u.role='super_admin' and u.active;

create function private.hub_personal_task_phone(p_company bigint,p_member uuid) returns text
language sql stable security definer set search_path='' as $$
 select r.phone from private.hub_personal_task_recipients r
 join public.crm_users u on u.id=r.member_id and u.active and u.role='super_admin'
 join public.hub_company_modules m on m.id_empresa=r.id_empresa and m.crm
 join public.hub_whatsapp_channels c on c.id_empresa=r.id_empresa and c.enabled
 join private.hub_whatsapp_transport t on t.id_empresa=r.id_empresa
 where r.id_empresa=p_company and r.member_id=p_member and r.enabled
 and t.worker_secret is not null and t.webhook_secret is not null and t.api_key_secret is not null
 and exists(select from private.hub_secretary_endpoints where singleton)
$$;
revoke all on function private.hub_personal_task_phone(bigint,uuid) from public,anon,authenticated;

create function private.hub_save_my_task_phone(p_company_id bigint,p_phone text,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 update private.hub_personal_task_recipients r set phone=nullif(p_phone,''),enabled=p_enabled
 from public.crm_users u where u.id=r.member_id and r.id_empresa=p_company_id
 and u.auth_user_id=auth.uid() and u.active and u.role='super_admin';
 if not found then raise exception 'Cadastro indisponível' using errcode='42501'; end if;
end $$;
create function public.hub_save_my_task_phone(p_company_id bigint,p_phone text,p_enabled boolean) returns void
language sql security invoker set search_path='' as $$ select private.hub_save_my_task_phone(p_company_id,p_phone,p_enabled) $$;
revoke all on function private.hub_save_my_task_phone(bigint,text,boolean),public.hub_save_my_task_phone(bigint,text,boolean) from public,anon;
grant execute on function private.hub_save_my_task_phone(bigint,text,boolean),public.hub_save_my_task_phone(bigint,text,boolean) to authenticated;
CREATE OR REPLACE FUNCTION private.hub_secretary_settings(p_company_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if not private.hub_sales_manager_native(p_company_id) then raise exception 'Acesso restrito ao gestor da empresa' using errcode='42501';end if;
 select jsonb_build_object('provider',c.provider,'instance',c.instance,'enabled',c.enabled,'autoSend',c.auto_send,'revision',c.revision,
 'inboundVerifiedAt',c.inbound_verified_at,'lastDispatchAt',c.last_dispatch_at,'baseUrl',t.base_url,'hasCredential',t.api_key_secret is not null)
 into result from public.hub_whatsapp_channels c left join private.hub_whatsapp_transport t using(id_empresa) where c.id_empresa=p_company_id;
 return jsonb_build_object('channel',result,'personal', (select jsonb_build_object('memberId',u.id,'name',u.nome,'phone',r.phone,'enabled',r.enabled) from private.hub_personal_task_recipients r join public.crm_users u on u.id=r.member_id where r.id_empresa=p_company_id and u.active and u.role='super_admin' and u.auth_user_id=auth.uid()),'recipients',coalesce((select jsonb_agg(jsonb_build_object('memberId',u.id,'name',u.nome,'phone',r.phone,'enabled',coalesce(r.enabled,false)))
 from public.crm_users u left join private.hub_whatsapp_recipients r on r.member_id=u.id and r.id_empresa=u.id_empresa
 where u.id_empresa=p_company_id and u.active and u.role in ('agent','corretor')),'[]'::jsonb));
end $function$
;
CREATE OR REPLACE FUNCTION private.hub_task_reminder_ready(p_company bigint, p_member uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select private.hub_personal_task_phone(p_company,p_member) is not null or exists(select 1 from public.hub_whatsapp_channels c
 join private.hub_whatsapp_recipients r on r.id_empresa=c.id_empresa
 join public.crm_users u on u.id=r.member_id and u.id_empresa=c.id_empresa
 join public.hub_company_modules m on m.id_empresa=c.id_empresa
 join private.hub_whatsapp_transport t on t.id_empresa=c.id_empresa
 where c.id_empresa=p_company and r.member_id=p_member and c.enabled and c.auto_send and c.inbound_verified_at is not null
 and r.enabled and nullif(r.phone,'') is not null and u.active and u.role in ('manager','gestor','agent','corretor') and m.crm
 and t.worker_secret is not null and t.api_key_secret is not null
 and exists(select 1 from private.hub_secretary_endpoints where singleton))
$function$
;
CREATE OR REPLACE FUNCTION private.hub_task_reminder_options(p_company_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('member_id',u.id,'ready',private.hub_task_reminder_ready(p_company_id,u.id))),'[]'::jsonb)
 from public.crm_users u where u.active and ((u.id_empresa=p_company_id and u.role in ('manager','gestor','agent','corretor')) or (u.role='super_admin' and u.auth_user_id=auth.uid() and exists(select from private.hub_personal_task_recipients r where r.member_id=u.id and r.id_empresa=p_company_id)))
 and private.hub_sales_module_enabled(p_company_id) and exists(select 1 from public.crm_users a where a.auth_user_id=auth.uid() and a.active
 and (a.role='super_admin' or (a.id_empresa=p_company_id and (a.role in ('manager','gestor') or a.id=u.id))))
$function$
;
CREATE OR REPLACE FUNCTION private.hub_claim_task_reminder(p_instance text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   or (private.hub_personal_task_phone(t.id_empresa,t.assigned_to) is null and not exists(select 1 from public.crm_users u where u.id=t.assigned_to and u.id_empresa=t.id_empresa and u.active and
    (u.role in ('manager','gestor') or (u.role in ('agent','corretor') and
      ((t.opportunity_id is not null and exists(select 1 from public.crm_opportunities o where o.id=t.opportunity_id and o.id_empresa=t.id_empresa and o.lead_id=t.lead_id and o.assigned_to=u.id))
       or (t.opportunity_id is null and (exists(select 1 from public.crm_leads l where l.id=t.lead_id and l.id_empresa=t.id_empresa and l.crm_assigned_to=u.id)
        or exists(select 1 from public.crm_opportunities o where o.lead_id=t.lead_id and o.id_empresa=t.id_empresa and o.assigned_to=u.id)))))))) then
   update private.hub_task_reminders set status='cancelled',reason='task_or_recipient_unavailable',updated_at=clock_timestamp() where id=j.id;continue;
  end if;
  select phone into target from private.hub_whatsapp_recipients where id_empresa=t.id_empresa and member_id=t.assigned_to and enabled;
  target:=coalesce(private.hub_personal_task_phone(t.id_empresa,t.assigned_to),target);
  select nome into contact_name from public.crm_leads where id=t.lead_id and id_empresa=t.id_empresa;
  update private.hub_task_reminders set status='sending',attempts=attempts+1,lease=gen_random_uuid(),claimed_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.id returning * into j;
  return jsonb_build_object('id',j.id,'lease',j.lease,'phone',target,'instance',p_instance,'body',
    'Lembrete de tarefa: '||t.titulo||E'\nLead: '||coalesce(contact_name,'Lead')||E'\nHorário: '||to_char(t.prazo at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' (Brasília)'||E'\nAbra suas tarefas: https://myhub.katsuki.com.br/tarefas');
 end loop;
 return null;
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
 if p_kind='worker' and p_operation='claim_task' then
  return private.hub_claim_task_reminder(config->>'instance');
 elsif p_kind='worker' and p_operation='claim' then
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
create function private.hub_dispatch_personal_task_reminders() returns void
language plpgsql security definer set search_path='' as $$
declare channel record;
begin
 for channel in
 select distinct c.id_empresa, s.decrypted_secret, e.base_url
 from private.hub_task_reminders j
 join private.hub_personal_task_recipients r using(id_empresa,member_id)
 join public.hub_whatsapp_channels c on c.id_empresa=j.id_empresa and c.enabled
 join private.hub_whatsapp_transport t on t.id_empresa=c.id_empresa
 join vault.decrypted_secrets s on s.id=t.worker_secret
 join private.hub_secretary_endpoints e on e.singleton
 where ((j.status='pending' and j.available_at<=now()) or (j.status='sending' and j.claimed_at<now()-interval '2 minutes'))
 loop
 perform net.http_post(url:=channel.base_url||'/hub-personal-task-worker',
 headers:=jsonb_build_object('Content-Type','application/json','x-hub-secret',channel.decrypted_secret),
 body:='{}'::jsonb,timeout_milliseconds:=30000);
 end loop;
end $$;
revoke all on function private.hub_dispatch_personal_task_reminders() from public,anon,authenticated;
select cron.schedule('hub-personal-task-reminders','* * * * *','select private.hub_dispatch_personal_task_reminders()');
revoke all on function public.hub_save_my_task_phone(bigint,text,boolean),private.hub_save_my_task_phone(bigint,text,boolean) from public,anon;
grant execute on function public.hub_save_my_task_phone(bigint,text,boolean),private.hub_save_my_task_phone(bigint,text,boolean) to authenticated;
