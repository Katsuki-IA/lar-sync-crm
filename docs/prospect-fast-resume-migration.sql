create or replace function private.kp_resume_followups_native(p_company bigint,p_lead bigint,p_start timestamptz default null,p_generation int default null,p_request uuid default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare actor public.crm_users;c private.kp_contacts; cfg private.kp_companies; l public.lead;
 saved private.kp_resume_requests; remaining int[]; first_step int; offsets int[]:=array[0,21,48];
 i int; previous_step int; at_time timestamptz; previous_at timestamptz; plan jsonb:='[]'; result jsonb; reason text;
 automatic_start boolean:=p_start is null;
begin
 select * into actor from public.crm_users where auth_user_id=auth.uid() and active;
 if actor.id is null or actor.role not in ('super_admin','manager','gestor','agent','corretor')
 or (actor.role<>'super_admin' and actor.id_empresa is distinct from p_company) then
  raise exception 'Sem acesso a esta empresa' using errcode='42501';end if;
 if p_company not in(35,36) or p_company is null then raise exception 'Retomada disponível apenas para Katsuki Prospecção 1 e 2';end if;
 -- Same resource IDs as the conversation attendance control (operational lead).
 select * into l from public.lead where id=p_lead and id_empresa=p_company;
 if not found then raise exception 'Conversa indisponível';end if;
 select * into c from private.kp_contacts where legacy_lead_id=p_lead and id_empresa=p_company for update;
 if not found then return jsonb_build_object('available',false,'reason','Este lead não pertence à base de prospecção.');end if;
 select * into cfg from private.kp_companies where id_empresa=p_company;
 if p_request is not null then
  select * into saved from private.kp_resume_requests where id=p_request;
  if found then
   if saved.contact_id<>c.id or saved.actor_id<>actor.id or (not automatic_start and saved.requested_at is distinct from p_start) then
    raise exception 'Solicitação já utilizada com outros dados';end if;
   return saved.result;
  end if;
 end if;
 if actor.role in('agent','corretor') and l.wa_conversation_assigned_to is distinct from actor.id then
  raise exception 'Assuma a conversa antes de retomar a cadência' using errcode='42501';end if;
 select * into l from public.lead where id=p_lead and id_empresa=p_company for update;
 if actor.role in('agent','corretor') and l.wa_conversation_assigned_to is distinct from actor.id then
  raise exception 'A conversa foi alterada por outro atendente' using errcode='42501';end if;
 perform 1 from private.kp_jobs where contact_id=c.id for update;
 select array_agg(s order by s) into remaining from generate_series(1,3) s
 where not exists(select 1 from private.kp_jobs where contact_id=c.id and step=s and status='accepted');
 if not cfg.enabled then reason:='A campanha está pausada.';
 elsif not exists(select 1 from public.hub_company_modules where id_empresa=p_company and crm) then reason:='CRM não habilitado.';
 elsif c.first_sent_at is null then reason:='A abordagem inicial ainda não foi enviada.';
 elsif c.status in('stopped','declined','review') then reason:='Lead recusou, está bloqueado ou precisa de revisão. A retomada não está disponível.';
 elsif exists(select 1 from private.kp_replies where contact_id=c.id and decision='opt_out') then reason:='O lead pediu para não receber mensagens.';
 elsif not public.wa_marketing_send_guard(cfg.phone_number_id,c.phone,null::bigint) then reason:='Envio bloqueado para este contato.';
 elsif remaining is null then reason:='Os três follow-ups já foram enviados.';
 elsif exists(select 1 from private.kp_jobs where contact_id=c.id and (status in('sending','review')
   or (step between 1 and 3 and status<>'accepted' and (message_id is not null or reserved_at is not null or token is not null)))) then
  reason:='Existe envio em andamento ou sem confirmação. Confira a entrega antes de retomar.';
 elsif exists(select 1 from private.kp_handoffs where contact_id=c.id and notice_state='sending') then reason:='Um alerta está sendo enviado. Tente novamente em instantes.';
 elsif exists(select 1 from private.kp_templates where id_empresa=p_company and step=any(remaining) and not approved)
 or (select count(*) from private.kp_templates where id_empresa=p_company and step=any(remaining) and approved)<>cardinality(remaining) then
  reason:='Há template de follow-up indisponível.';
 end if;
 if reason is not null then
  if p_start is not null or p_request is not null then raise exception '%',reason;end if;
  return jsonb_build_object('available',false,'reason',reason);
 end if;
 if automatic_start then p_start:=private.kp_next_business_time(clock_timestamp()+interval '5 minutes');end if;
 if (p_request is not null or not automatic_start) and (p_request is null or p_generation is distinct from c.generation) then
  raise exception 'A conversa mudou. Feche e reabra a janela antes de confirmar.' using errcode='PT409';end if;
 if not isfinite(p_start) or p_start<=clock_timestamp() or p_start>clock_timestamp()+interval '365 days' then
  raise exception 'Escolha uma data futura, dentro dos próximos 365 dias.';end if;
 first_step:=remaining[1];
 foreach i in array remaining loop
  at_time:=private.kp_next_business_time(greatest(coalesce(previous_at+(offsets[i]-offsets[previous_step])*interval '1 hour',p_start),
    case when automatic_start then p_start else coalesce(c.last_sent_at,p_start-interval '1 hour')+interval '1 hour' end));
  plan:=plan||jsonb_build_array(jsonb_build_object('step',i,'due_at',at_time));
  previous_at:=at_time;
  previous_step:=i;
 end loop;
 if automatic_start and p_request is null then
  return jsonb_build_object('available',true,'generation',c.generation,'steps',remaining,'suggested_at',p_start,'scheduled',plan);
 end if;
 -- Release and reschedule commit together. No change to commercial stages/ownership.
 perform * from public.crm_whatsapp_set_conversation_attendance(p_lead,false,false);
 update private.kp_contacts set status='active',generation=generation+1 where id=c.id returning * into c;
 update private.kp_jobs set status='cancelled' where contact_id=c.id and status='pending';
 for i,at_time in select (x->>'step')::int,(x->>'due_at')::timestamptz from jsonb_array_elements(plan) x loop
  insert into private.kp_jobs(contact_id,step,due_at,generation)
  values(c.id,i,at_time,c.generation)
  on conflict(contact_id,step) where step<=5 do update
   set due_at=excluded.due_at,generation=excluded.generation,status='pending',body=null,error=null;
 end loop;
 -- Dismiss the old handoff notice; a fresh reply will re-open it.
 update private.kp_handoffs set status='assumed',seen_at=coalesce(seen_at,clock_timestamp()),
  notice_state=case when notice_state='pending' then 'cancelled' else notice_state end where contact_id=c.id;
 result:=jsonb_build_object('scheduled',plan,'generation',c.generation,'available',true,'fast_resume',automatic_start);
 insert into private.kp_resume_requests(id,contact_id,actor_id,requested_at,result) values(p_request,c.id,actor.id,p_start,result);
 insert into public.crm_lead_activities(lead_id,crm_user_id,tipo,descricao,metadata)
 values(c.crm_lead_id,actor.id,'assignment','Cadência de follow-ups retomada manualmente.',
  jsonb_build_object('source','katsuki_followup_resume','request_id',p_request,'scheduled',plan));
 return result;
end $$;
-- Only the first pending step of an explicit, current-generation fast resumption
-- may bypass the routine one-hour throttle. Ordinary campaigns keep that guard.
create or replace function private.kp_is_fast_resume(p_contact uuid,p_generation int,p_step int)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.kp_resume_requests r
 where r.contact_id=p_contact and r.result->>'fast_resume'='true'
 and (r.result->>'generation')::int=p_generation
 and (r.result->'scheduled'->0->>'step')::int=p_step);
$$;
revoke all on function private.kp_is_fast_resume(uuid,int,int) from public,anon,authenticated;

do $patch$
declare definition text; target regprocedure;
old_guard text:='c.last_sent_at+interval ''1 hour''>p_now';
begin
 select p.oid::regprocedure into strict target from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname='kp_claim';
 definition:=pg_get_functiondef(target);
 if strpos(definition,old_guard)=0 or strpos(definition,'kp_is_fast_resume')>0 then raise exception 'Unexpected claim definition';end if;
 definition:=replace(definition,old_guard,'('||old_guard||' and not private.kp_is_fast_resume(c.id,j.generation,j.step))');
 execute definition;
end $patch$;

