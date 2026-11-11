alter table private.kp_contacts add column if not exists followups_paused boolean not null default false;

create or replace function private.hub_pause_prospect_followups(p_company bigint,p_lead bigint)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare actor public.crm_users;c private.kp_contacts;l public.lead; cancelled int; in_flight boolean;
begin
 select * into actor from public.crm_users where auth_user_id=auth.uid() and active;
 if actor.id is null or actor.role not in ('super_admin','manager','gestor','agent','corretor')
 or (actor.role<>'super_admin' and actor.id_empresa is distinct from p_company) then
  raise exception 'Sem acesso a esta empresa' using errcode='42501';end if;
 if p_company not in(35,36) or p_company is null then raise exception 'Empresa não habilitada';end if;
 if actor.role in('agent','corretor') and p_lead not in(select private.hub_agent_operational_lead_ids()) then
  raise exception 'Sem acesso a esta conversa' using errcode='42501';end if;
 select * into c from private.kp_contacts where legacy_lead_id=p_lead and id_empresa=p_company for update;
 if not found then raise exception 'Lead de prospecção não encontrado';end if;
 select * into l from public.lead where id=p_lead and id_empresa=p_company for update;
 if not found then raise exception 'Conversa não encontrada';end if;
 if l.wa_conversation_assigned_to is not null and l.wa_conversation_assigned_to<>actor.id
 and actor.role not in('super_admin','manager','gestor') then raise exception 'Conversa de outro atendente' using errcode='42501';end if;
 perform 1 from private.kp_jobs where contact_id=c.id and step between 1 and 3 for update;
 select exists(select 1 from private.kp_jobs where contact_id=c.id and step between 1 and 3 and status='sending') into in_flight;
 update private.kp_contacts set followups_paused=true where id=c.id;
 update private.kp_jobs set status='cancelled' where contact_id=c.id and step between 1 and 3 and status='pending';
 get diagnostics cancelled=row_count;
 if not c.followups_paused then
  insert into public.crm_lead_activities(lead_id,crm_user_id,tipo,descricao,metadata)
  values(c.crm_lead_id,actor.id,'assignment','Follow-ups pausados manualmente.',jsonb_build_object('source','katsuki_followup_pause','cancelled',cancelled));
 end if;
 return jsonb_build_object('paused',true,'cancelled',cancelled,'in_flight',in_flight);
end $$;
revoke all on function private.hub_pause_prospect_followups(bigint,bigint) from public,anon;
grant execute on function private.hub_pause_prospect_followups(bigint,bigint) to authenticated;
create or replace function public.hub_pause_prospect_followups(p_company bigint,p_lead bigint)
returns jsonb language sql security invoker set search_path='' as $$
 select private.hub_pause_prospect_followups(p_company,p_lead);
$$;
revoke all on function public.hub_pause_prospect_followups(bigint,bigint) from public,anon;
grant execute on function public.hub_pause_prospect_followups(bigint,bigint) to authenticated;

do $patch$
declare target regprocedure; definition text; anchor text; replacement text; fname text;
begin
 foreach fname in array array['kp_claim','kp_preflight','kp_resume_followups_native','hub_prospect_followup_indicators'] loop
  select p.oid::regprocedure into strict target from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=fname;
  definition:=pg_get_functiondef(target);
  case fname
   when 'kp_claim' then
    anchor:='if j.step between 1 and 3 and (c.first_sent_at is null';
    replacement:='if j.step between 1 and 3 and c.followups_paused then update private.kp_jobs set status=''cancelled'' where contact_id=c.id and step between 1 and 3 and status=''pending''; continue; end if; '||anchor;
   when 'kp_preflight' then
    anchor:='if not cfg.enabled or';
    replacement:='if (j.step between 1 and 3 and c.followups_paused) or not cfg.enabled or';
   when 'kp_resume_followups_native' then
    anchor:='set status=''active'',generation=generation+1';
    replacement:='set followups_paused=false,status=''active'',generation=generation+1';
   else
    anchor:='and c.status=''active''';
    replacement:='and c.status=''active'' and not c.followups_paused';
  end case;
  if strpos(definition,anchor)=0 then raise exception 'Unexpected definition %',fname;end if;
  execute replace(definition,anchor,replacement);
 end loop;
end $patch$;
