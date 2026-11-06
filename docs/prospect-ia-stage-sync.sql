create or replace function private.kp_sync_ia_stage(p_contact uuid)
returns bigint language plpgsql set search_path='' as $function$
declare c private.kp_contacts; current_stage bigint; previous_projection text; target_global bigint;
 target_stage bigint; target_name text; matches int; last_step int; last_accepted timestamptz;
begin
 select * into c from private.kp_contacts where id=p_contact for update;
 if not found or c.id_empresa not in (35,36) or c.crm_lead_id is null then return null;end if;
 select crm_stage_id into current_stage from public.crm_leads where id=c.crm_lead_id and id_empresa=c.id_empresa for update;
 if not found then return null;end if;
 -- Never overwrite a manually selected stage. Only null or our last projection is managed.
 select metadata->>'to_stage_id' into previous_projection from public.crm_lead_activities
 where lead_id=c.crm_lead_id and metadata->>'event'='kp_ia_stage_sync' order by id desc limit 1;
 if current_stage is not null and current_stage::text is distinct from previous_projection then return current_stage;end if;
 select step,accepted_at into last_step,last_accepted from private.kp_jobs
 where contact_id=c.id and status='accepted' and step between 0 and 4
 order by accepted_at desc nulls last,id desc limit 1;
 if exists(select 1 from private.kp_handoffs where contact_id=c.id)
  or (c.status='human' and exists(select 1 from public.lead where id=c.legacy_lead_id and id_empresa=c.id_empresa
   and (atendimento_humano or wa_conversation_assigned_to is not null))) then target_global:=13;
 elsif c.status='declined' then target_global:=7;
 elsif c.status='stopped' or exists(select 1 from private.kp_jobs where contact_id=c.id and status='review'
  and reserved_at is not null and (last_accepted is null or reserved_at>last_accepted)) then target_global:=12;
 elsif last_step between 1 and 3 then target_global:=last_step+7;
 elsif last_step is not null or c.first_sent_at is not null or c.last_reply_at is not null then target_global:=2;
 else target_global:=1;
 end if;
 select count(*),min(s.id),min(s.nome) into matches,target_stage,target_name
 from public.crm_stages s join public.crm_funnels f on f.id=s.id_funnel and f.id_empresa=s.id_empresa
 where s.id_empresa=c.id_empresa and s.module='ia' and s.ativo and f.module='ia' and f.ativo and s.global_stage_id=target_global;
 -- Missing/ambiguous configuration must never roll back an accepted WhatsApp receipt.
 if matches<>1 then return current_stage;end if;
 if current_stage is not distinct from target_stage then return target_stage;end if;
 update public.crm_leads set crm_stage_id=target_stage where id=c.crm_lead_id and id_empresa=c.id_empresa;
 insert into public.crm_lead_activities(lead_id,tipo,descricao,metadata)
 values(c.crm_lead_id,'stage_change','Prospecção: estágio IA atualizado para '||target_name,
 jsonb_build_object('event','kp_ia_stage_sync','contact_id',c.id,'from_stage_id',current_stage,
 'to_stage_id',target_stage,'global_stage_id',target_global,'source','katsuki_prospect'));
 -- Stage projection is informational; it must not enqueue a second commercial distribution.
 delete from private.hub_queue_intake where lead_id=c.crm_lead_id and id_empresa=c.id_empresa;
 if target_global=13 then
  delete from private.hub_sales_waiting w using public.crm_opportunities o
  where w.opportunity_id=o.id and o.lead_id=c.crm_lead_id and o.id_empresa=c.id_empresa and w.id_empresa=c.id_empresa;
 end if;
 return target_stage;
end $function$;
revoke all on function private.kp_sync_ia_stage(uuid) from public,anon,authenticated;

create or replace function private.kp_project_ia_stage_event()
returns trigger language plpgsql set search_path='' as $function$
begin
 if tg_table_name='kp_contacts' then
  perform private.kp_sync_ia_stage(new.id);
 else
  perform private.kp_sync_ia_stage(new.contact_id);
 end if;
 return new;
end $function$;
revoke all on function private.kp_project_ia_stage_event() from public,anon,authenticated;
create trigger kp_project_ia_contact_insert after insert on private.kp_contacts
 for each row when (new.crm_lead_id is not null) execute function private.kp_project_ia_stage_event();
create trigger kp_project_ia_contact_update after update of crm_lead_id,status,last_sent_at,last_reply_at on private.kp_contacts
 for each row when (new.crm_lead_id is not null) execute function private.kp_project_ia_stage_event();
create trigger kp_project_ia_job after insert or update of status on private.kp_jobs
 for each row when (new.status in ('accepted','review')) execute function private.kp_project_ia_stage_event();
create trigger kp_project_ia_handoff after insert on private.kp_handoffs
 for each row execute function private.kp_project_ia_stage_event();

