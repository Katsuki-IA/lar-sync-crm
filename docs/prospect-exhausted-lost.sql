-- Exhausted prospects with no reply become commercial Lost opportunities.
-- Never move an existing opportunity or overwrite a human-owned conversation.
create or replace function private.kp_close_unanswered(p_now timestamptz default clock_timestamp())
returns int language plpgsql set search_path='' set lock_timeout='3s' as $$
declare c private.kp_contacts;l public.lead;target_funnel bigint;target_stage bigint;matches int;op uuid;closed int:=0;
begin
 for c in select co.* from private.kp_contacts co
 where co.id_empresa in(35,36) and co.status='complete' and co.last_reply_at is null
 and co.crm_lead_id is not null and not co.followups_paused
 and not exists(select 1 from private.kp_replies r where r.contact_id=co.id)
 and not exists(select 1 from private.kp_handoffs h where h.contact_id=co.id)
 and not exists(select 1 from public.crm_opportunities o where o.id_empresa=co.id_empresa and o.lead_id=co.crm_lead_id)
 and (select count(*) from private.kp_jobs j where j.contact_id=co.id and j.step between 1 and 3 and j.status='accepted')=3
 and (select max(j.accepted_at) from private.kp_jobs j where j.contact_id=co.id and j.step between 1 and 3 and j.status='accepted')<=p_now-interval '24 hours'
 order by co.id for update of co skip locked limit 200
 loop
  select * into l from public.lead where id=c.legacy_lead_id and id_empresa=c.id_empresa for update;
  if not found or coalesce(l.atendimento_humano,false) or l.wa_conversation_assigned_to is not null then continue;end if;
  perform 1 from public.crm_leads where id=c.crm_lead_id and id_empresa=c.id_empresa for update;
  if not found then continue;end if;
  if exists(select 1 from public.crm_opportunities where lead_id=c.crm_lead_id and id_empresa=c.id_empresa) then continue;end if;
  select count(*),min(f.id),min(s.id) into matches,target_funnel,target_stage
  from public.crm_funnels f join public.crm_stages s on s.id_funnel=f.id and s.id_empresa=f.id_empresa
  where f.id_empresa=c.id_empresa and f.module='crm' and f.ativo and f.nome='Vendas'
  and s.module='crm' and s.ativo and lower(btrim(s.nome))='perdido';
  if matches<>1 then continue;end if;
  op:=null;
  insert into public.crm_opportunities(id_empresa,lead_id,funnel_id,stage_id,title,request_id,creation_origin)
  values(c.id_empresa,c.crm_lead_id,target_funnel,target_stage,left(coalesce(nullif(btrim(c.name),''),'Lead Katsuki'),200),c.id,'queue')
  on conflict do nothing returning id into op;
  if op is null then continue;end if;
  delete from private.hub_sales_waiting where opportunity_id=op and id_empresa=c.id_empresa;
  insert into public.crm_opportunity_events(opportunity_id,id_empresa,kind,to_stage_id)
  values(op,c.id_empresa,'created',target_stage);
  insert into public.crm_lead_activities(lead_id,tipo,descricao,metadata)
  values(c.crm_lead_id,'stage_change','Oportunidade criada em Perdido: sem resposta após os três follow-ups e 24 horas de espera.',
   jsonb_build_object('event','kp_exhausted_lost','opportunity_id',op,'contact_id',c.id,'source','katsuki_prospect'));
  closed:=closed+1;
 end loop;
 return closed;
end $$;
revoke all on function private.kp_close_unanswered(timestamptz) from public,anon,authenticated;

select cron.schedule('katsuki-close-unanswered','*/5 * * * *','select private.kp_close_unanswered();');
