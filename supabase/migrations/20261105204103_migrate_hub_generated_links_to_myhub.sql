DO $guard$ BEGIN IF pg_get_functiondef('private.hub_claim_task_reminder(text)'::regprocedure) <> $before$CREATE OR REPLACE FUNCTION private.hub_claim_task_reminder(p_instance text)
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
end $function$
$before$ THEN RAISE EXCEPTION 'Concurrent edit: hub_claim_task_reminder'; END IF; END $guard$;
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
    'Lembrete de tarefa: '||t.titulo||E'\nLead: '||coalesce(contact_name,'Lead')||E'\nHorário: '||to_char(t.prazo at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' (Brasília)'||E'\nAbra suas tarefas: https://myhub.katsuki.com.br/tarefas');
 end loop;
 return null;
end $function$
;
DO $guard$ BEGIN IF pg_get_functiondef('private.kp_claim_notice()'::regprocedure) <> $before$CREATE OR REPLACE FUNCTION private.kp_claim_notice()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare h private.kp_handoffs;c private.kp_contacts;cfg private.kp_companies;channel record;api_key text;
begin
 for h in select hf.* from private.kp_handoffs hf join private.kp_contacts co on co.id=hf.contact_id
  join private.kp_companies cf on cf.id_empresa=co.id_empresa and cf.enabled
  where hf.notice_state='pending' order by hf.created_at for update of hf skip locked limit 2 loop
  select * into c from private.kp_contacts where id=h.contact_id;
  select * into cfg from private.kp_companies where id_empresa=c.id_empresa;
  if h.status='assumed' then update private.kp_handoffs set notice_state='cancelled' where id=h.id;continue;end if;
  select ch.provider,ch.instance,tr.base_url,tr.api_key_secret into channel
   from public.hub_whatsapp_channels ch join private.hub_whatsapp_transport tr using(id_empresa)
   join public.hub_company_modules cm on cm.id_empresa=c.id_empresa
   join public.crm_users u on u.id=cfg.recipient_id and u.active and u.role='super_admin'
   where c.id_empresa in (35,36) and ch.id_empresa=35 and ch.enabled and ch.kp_notices_enabled and cm.crm and cfg.recipient_phone='554188574242' and cfg.recipient_id='36ac39f5-27e6-45aa-a28c-42de74836395';
  if not found then continue;end if;
  if not ((channel.provider='evolution' and channel.base_url='https://evolution.henaweb.com.br')
   or (channel.provider='uazapi' and channel.base_url ~ '^https://[a-z0-9-]+[.]uazapi[.]com$')) then continue;end if;
  if channel.instance is null or channel.instance !~ '^[a-zA-Z0-9_-]+$' then continue;end if;
  select decrypted_secret into api_key from vault.decrypted_secrets where id=channel.api_key_secret;
  if nullif(api_key,'') is null then continue;end if;
  update private.kp_handoffs set notice_state='sending',notice_token=gen_random_uuid(),notice_started_at=clock_timestamp() where id=h.id returning * into h;
  return next jsonb_build_object('id',h.id,'token',h.notice_token,'provider',channel.provider,'base_url',channel.base_url,'instance',channel.instance,'api_key',api_key,'phone',cfg.recipient_phone,
   'body','Ana, '||c.name||' demonstrou interesse na IA da Katsuki. Abra o Hub, assuma a conversa pelo link https://hub.katsuki.com.br/conversas?lead='||c.crm_lead_id||'. Telefone do lead: '||c.phone||'.');
 end loop;
end $function$
$before$ THEN RAISE EXCEPTION 'Concurrent edit: kp_claim_notice'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION private.kp_claim_notice()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare h private.kp_handoffs;c private.kp_contacts;cfg private.kp_companies;channel record;api_key text;
begin
 for h in select hf.* from private.kp_handoffs hf join private.kp_contacts co on co.id=hf.contact_id
  join private.kp_companies cf on cf.id_empresa=co.id_empresa and cf.enabled
  where hf.notice_state='pending' order by hf.created_at for update of hf skip locked limit 2 loop
  select * into c from private.kp_contacts where id=h.contact_id;
  select * into cfg from private.kp_companies where id_empresa=c.id_empresa;
  if h.status='assumed' then update private.kp_handoffs set notice_state='cancelled' where id=h.id;continue;end if;
  select ch.provider,ch.instance,tr.base_url,tr.api_key_secret into channel
   from public.hub_whatsapp_channels ch join private.hub_whatsapp_transport tr using(id_empresa)
   join public.hub_company_modules cm on cm.id_empresa=c.id_empresa
   join public.crm_users u on u.id=cfg.recipient_id and u.active and u.role='super_admin'
   where c.id_empresa in (35,36) and ch.id_empresa=35 and ch.enabled and ch.kp_notices_enabled and cm.crm and cfg.recipient_phone='554188574242' and cfg.recipient_id='36ac39f5-27e6-45aa-a28c-42de74836395';
  if not found then continue;end if;
  if not ((channel.provider='evolution' and channel.base_url='https://evolution.henaweb.com.br')
   or (channel.provider='uazapi' and channel.base_url ~ '^https://[a-z0-9-]+[.]uazapi[.]com$')) then continue;end if;
  if channel.instance is null or channel.instance !~ '^[a-zA-Z0-9_-]+$' then continue;end if;
  select decrypted_secret into api_key from vault.decrypted_secrets where id=channel.api_key_secret;
  if nullif(api_key,'') is null then continue;end if;
  update private.kp_handoffs set notice_state='sending',notice_token=gen_random_uuid(),notice_started_at=clock_timestamp() where id=h.id returning * into h;
  return next jsonb_build_object('id',h.id,'token',h.notice_token,'provider',channel.provider,'base_url',channel.base_url,'instance',channel.instance,'api_key',api_key,'phone',cfg.recipient_phone,
   'body','Ana, '||c.name||' demonstrou interesse na IA da Katsuki. Abra o Hub, assuma a conversa pelo link https://myhub.katsuki.com.br/conversas?lead='||c.crm_lead_id||'. Telefone do lead: '||c.phone||'.');
 end loop;
end $function$
;
