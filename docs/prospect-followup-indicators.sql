create or replace function private.hub_prospect_followup_indicators(p_company bigint,p_leads bigint[])
returns table(lead_id bigint,next_step int,next_due_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare actor public.crm_users;
begin
 select * into actor from public.crm_users where auth_user_id=auth.uid() and active;
 if actor.id is null or actor.role not in ('super_admin','manager','gestor','agent','corretor')
 or (actor.role<>'super_admin' and actor.id_empresa is distinct from p_company) then
  raise exception 'Sem acesso a esta empresa' using errcode='42501';end if;
 if p_company not in (35,36) or p_company is null then return;end if;
 return query
 select l.id,j.step::int,j.due_at
 from public.lead l
 join private.kp_contacts c on c.legacy_lead_id=l.id and c.id_empresa=l.id_empresa
 join private.kp_companies cfg on cfg.id_empresa=c.id_empresa and cfg.enabled
 join lateral (
  select job.step,job.due_at from private.kp_jobs job
  join private.kp_templates t on t.id_empresa=c.id_empresa and t.step=job.step and t.approved
  where job.contact_id=c.id and job.generation=c.generation
  and job.step between 1 and 3 and job.status in ('pending','sending')
  order by job.due_at,job.step limit 1
 ) j on true
 where l.id_empresa=p_company and l.id=any(p_leads) and c.status='active'
 and not coalesce(l.atendimento_humano,false) and l.wa_conversation_assigned_to is null
 and c.first_sent_at is not null
 and (actor.role not in ('agent','corretor') or l.id in(select private.hub_agent_operational_lead_ids()))
 and not exists(select 1 from private.kp_jobs x where x.contact_id=c.id and x.status='review')
 and public.wa_marketing_send_guard(cfg.phone_number_id,c.phone,null::bigint);
end $$;
revoke all on function private.hub_prospect_followup_indicators(bigint,bigint[]) from public,anon;
grant execute on function private.hub_prospect_followup_indicators(bigint,bigint[]) to authenticated;
create or replace function public.hub_prospect_followup_indicators(p_company bigint,p_leads bigint[])
returns table(lead_id bigint,next_step int,next_due_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select * from private.hub_prospect_followup_indicators(p_company,p_leads);
$$;
revoke all on function public.hub_prospect_followup_indicators(bigint,bigint[]) from public,anon;
grant execute on function public.hub_prospect_followup_indicators(bigint,bigint[]) to authenticated;
