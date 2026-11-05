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
  select * into assignee from public.crm_users where id=p_assigned_to and active is true and ((id_empresa=p_company_id and role in ('manager','agent','gestor','corretor')) or (id=actor.id and role='super_admin')) for share;
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

