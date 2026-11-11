-- Explicit, per-contact resumption; no bulk activation or message sends.
create table private.kp_resume_requests (
 id uuid primary key,
 contact_id uuid not null references private.kp_contacts(id),
 actor_id uuid not null references public.crm_users(id),
 requested_at timestamptz not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.kp_resume_requests enable row level security;
revoke all on private.kp_resume_requests from public,anon,authenticated;

create function private.kp_next_business_time(p_at timestamptz) returns timestamptz
language plpgsql immutable set search_path='' as $$
declare local_at timestamp:=p_at at time zone 'America/Sao_Paulo';
begin
 if local_at::time>=time '18:50' then local_at:=(local_at::date+1)+time '08:00';end if;
 if local_at::time<time '08:00' then local_at:=local_at::date+time '08:00';end if;
 while extract(isodow from local_at)>5 loop local_at:=(local_at::date+1)+time '08:00';end loop;
 return local_at at time zone 'America/Sao_Paulo';
end $$;
revoke all on function private.kp_next_business_time(timestamptz) from public,anon,authenticated;

create function private.kp_resume_followups_native(p_company bigint,p_lead bigint,p_start timestamptz default null,p_generation int default null,p_request uuid default null)
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
 update private.kp_contacts set followups_paused=false,status='active',generation=generation+1 where id=c.id returning * into c;
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
revoke all on function private.kp_resume_followups_native(bigint,bigint,timestamptz,int,uuid) from public,anon;
grant execute on function private.kp_resume_followups_native(bigint,bigint,timestamptz,int,uuid) to authenticated;
create function public.hub_resume_prospect_followups(p_company bigint,p_lead bigint,p_start timestamptz default null,p_generation int default null,p_request uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.kp_resume_followups_native(p_company,p_lead,p_start,p_generation,p_request);
$$;
revoke all on function public.hub_resume_prospect_followups(bigint,bigint,timestamptz,int,uuid) from public,anon;
grant execute on function public.hub_resume_prospect_followups(bigint,bigint,timestamptz,int,uuid) to authenticated;

-- Only a new reply after an explicit resumption re-arms the existing handoff.
do $patch$
declare definition text:=pg_get_functiondef('private.kp_handoff_presented(uuid,text)'::regprocedure);
 anchor text:='insert into private.kp_handoffs(contact_id,reply_id) values(c.id,r.id) on conflict(contact_id) do nothing;';
begin
 if strpos(definition,anchor)=0 then raise exception 'Unexpected handoff definition';end if;
 definition:=replace(definition,anchor,anchor||$new$
 update private.kp_handoffs h set reply_id=r.id,status='pending',created_at=clock_timestamp(),seen_at=null,
  notice_state='pending',notice_token=null,notice_started_at=null,notice_provider_id=null,notice_error=null
 where h.contact_id=c.id and h.reply_id<>r.id and h.notice_state<>'sending'
 and exists(select 1 from private.kp_resume_requests rr where rr.contact_id=c.id and rr.created_at>h.created_at and r.created_at>rr.created_at);
 $new$);
 execute definition;
end $patch$;
