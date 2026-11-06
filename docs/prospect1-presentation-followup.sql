CREATE OR REPLACE FUNCTION private.kp_schedule_offer_followups(p_contact uuid, p_now timestamptz default clock_timestamp())
RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $function$
declare c private.kp_contacts; presentation private.kp_jobs; anchor_at timestamptz; offsets int[]:=array[2,23,50]; i int;
begin
 select * into c from private.kp_contacts where id=p_contact for update;
 if not found or c.id_empresa<>35 or c.status<>'answered' or c.phase<>'offer' then return false;end if;
 if not exists(select 1 from private.kp_companies where id_empresa=c.id_empresa and enabled) then return false;end if;
 select * into presentation from private.kp_jobs where contact_id=c.id and step=4 and status='accepted';
 if not found or presentation.accepted_at is null or presentation.generation<>c.generation
  or c.last_reply_at is null or c.last_reply_at>=presentation.accepted_at then return false;end if;
 perform 1 from public.lead where id=c.legacy_lead_id and id_empresa=c.id_empresa for update;
 if not found or exists(select 1 from public.lead where id=c.legacy_lead_id and (atendimento_humano or wa_conversation_assigned_to is not null))
  or exists(select 1 from private.kp_handoffs where contact_id=c.id) then return false;end if;
 -- Overdue recovery starts at FUP1 now, preserving the remaining spacing.
 anchor_at:=greatest(presentation.accepted_at,p_now-interval '2 hours');
 for i in 1..3 loop
  insert into private.kp_jobs(contact_id,step,due_at,generation)
  values(c.id,i,anchor_at+offsets[i]*interval '1 hour',c.generation)
  on conflict(contact_id,step) where step<=5 do update
  set status='pending',due_at=excluded.due_at,generation=excluded.generation,body=null,error=null
  where kp_jobs.status='cancelled' and kp_jobs.message_id is null and kp_jobs.reserved_at is null and kp_jobs.token is null;
 end loop;
 update private.kp_contacts set status='active' where id=c.id;
 return true;
end $function$;
revoke all on function private.kp_schedule_offer_followups(uuid,timestamptz) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.kp_complete(p_id uuid, p_token uuid, p_message_id text, p_error text DEFAULT NULL::text, p_now timestamp with time zone DEFAULT clock_timestamp())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j private.kp_jobs;c private.kp_contacts;i int;offsets int[]:=array[2,23,50];
begin
 select co.* into c from private.kp_contacts co join private.kp_jobs x on x.contact_id=co.id where x.id=p_id for update of co;
 select * into j from private.kp_jobs where id=p_id for update;
 if not found or j.token is distinct from p_token or p_token is null then raise exception 'Invalid send receipt';end if;
 if j.status='accepted' and j.message_id=p_message_id then return jsonb_build_object('duplicate',true);end if;
 if j.status<>'sending' then raise exception 'Job not awaiting receipt';end if;
 if p_message_id is null or p_message_id not like 'wamid.%' or p_error is not null then
  update private.kp_jobs set status='review',error=coalesce(p_error,'unknown_transport_outcome') where id=j.id;
  update private.kp_contacts set status='review' where id=c.id and status='active';
  return jsonb_build_object('accepted',false,'review',true);
 end if;
 update private.kp_jobs set status='accepted',message_id=p_message_id,accepted_at=p_now where id=j.id;
 update public.wa_messages set message_id=p_message_id,sent_at=coalesce(sent_at,p_now),
  status_current=case when status_current in ('sent','delivered','read','failed') then status_current else 'accepted' end
  where client_message_id='kp:'||j.id and tenant_id=c.id_empresa;
 update private.kp_contacts set last_sent_at=p_now,last_outbound=j.body,
  phase=case when j.step>=1 then 'offer' else phase end,
  first_sent_at=case when j.step=0 then coalesce(first_sent_at,p_now) else first_sent_at end,
  status=case when j.step=3 and status='active' then 'complete' else status end where id=c.id;
 if j.step=0 and c.status='active' and c.generation=j.generation then
  for i in 1..3 loop
   insert into private.kp_jobs(contact_id,step,due_at,generation) values(c.id,i,p_now+offsets[i]*interval '1 hour',c.generation) on conflict do nothing;
  end loop;
 end if;
 if j.step=4 and c.generation=j.generation then
  if c.id_empresa=35 then
   perform private.kp_schedule_offer_followups(c.id,p_now);
  elsif j.reply_id is not null then
   perform private.kp_handoff_presented(c.id,j.reply_id);
  end if;
 end if;
 return jsonb_build_object('accepted',true);
end $function$
;
CREATE OR REPLACE FUNCTION private.kp_handoff_presented(p_contact uuid, p_reply text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c private.kp_contacts;r private.kp_replies;cfg private.kp_companies;
begin
 select * into c from private.kp_contacts where id=p_contact for update;
 select * into r from private.kp_replies where id=p_reply and contact_id=c.id;
 if c.id_empresa not in (35,36) or c.status<>'answered' or r.id is null
 or r.generation<>c.generation or r.status<>'done' or r.decision not in ('response_received','interested')
 or c.last_reply_id is distinct from r.id then return false;end if;
 if c.id_empresa=35 and not exists(select 1 from private.kp_jobs
  where contact_id=c.id and step=4 and status='accepted' and r.generation>generation) then return false;end if;
 select * into cfg from private.kp_companies where id_empresa=c.id_empresa;
 if not cfg.enabled then return false;end if;
 perform 1 from public.lead where id=c.legacy_lead_id and id_empresa=c.id_empresa for update;
 if exists(select 1 from public.lead where id=c.legacy_lead_id and (atendimento_humano or wa_conversation_assigned_to is not null)) then return false;end if;
 if not exists(select 1 from private.kp_jobs where contact_id=c.id and step=4 and status='accepted') then return false;end if;
 update private.kp_contacts set status='human' where id=c.id;
 update public.lead set atendimento_humano=true,atendimento_humano_desde=clock_timestamp(),status='desativado' where id=c.legacy_lead_id and id_empresa=c.id_empresa;
 if cfg.interested_stage_id is not null then
  if not exists(select 1 from public.crm_stages where id=cfg.interested_stage_id and id_empresa=c.id_empresa and ativo) then raise exception 'Invalid handoff stage';end if;
  update public.crm_leads set crm_stage_id=cfg.interested_stage_id where id=c.crm_lead_id and id_empresa=c.id_empresa;
 end if;
 insert into private.kp_handoffs(contact_id,reply_id) values(c.id,r.id) on conflict(contact_id) do nothing;
 return true;
end $function$
;

