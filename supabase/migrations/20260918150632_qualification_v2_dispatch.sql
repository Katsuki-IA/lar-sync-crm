-- Additive rollout: no historical reclassification or automatic opt-in.
alter table public.crm_lead_dispatch_settings
  add column if not exists send_when_qualified boolean not null default false,
  add column if not exists cv_distribution_queue_qualified_id text;
alter table public.lead
  add column if not exists interesse_comercial boolean not null default false,
  add column if not exists qualificacao_motivo text,
  add column if not exists qualificacao_message_id text;
alter table public.crm_leads
  add column if not exists interesse_comercial boolean not null default false;

create schema if not exists private;

-- Called only from triggers after the originating write has passed table RLS.
-- No network requests run inside this transaction.
create or replace function private.enqueue_qualified_lead(p_company bigint, p_lead bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.crm_lead_dispatch_settings;
  v_lead public.crm_leads;
  v_job public.crm_external_dispatch_queue;
  v_payload jsonb;
begin
  select * into v_settings from public.crm_lead_dispatch_settings where id_empresa=p_company;
  if not coalesce(v_settings.send_when_qualified,false) then return; end if;
  select * into v_lead from public.crm_leads where id=p_lead and id_empresa=p_company;
  if not found then return; end if;
  perform pg_advisory_xact_lock(p_lead);
  if exists(select 1 from public.crm_external_crm_send_logs where lead_id=p_lead and status='sent')
    or exists(select 1 from public.crm_lead_activities where lead_id=p_lead and tipo='crm_export'
      and (metadata->>'event'='external_crm_sent' or (lower(descricao) like '%lead enviado ao crm%' and lower(descricao) like '%com sucesso%')))
  then return; end if;
  select * into v_job from public.crm_external_dispatch_queue
    where crm_lead_id=p_lead and status in ('pending','processing') for update;
  if found and (v_job.status='processing' or v_job.payload->>'enforceQualificationRule'='true') then return; end if;
  v_payload := jsonb_build_object('leadId',p_lead,'idEmpresa',p_company,
    'externalStageKind','qualified','enforceQualificationRule',true,'additionalTags',jsonb_build_array('Qualificado'));
  if v_job.id is not null then
    -- Preserve any previously scheduled follow-up if qualification is withdrawn.
    v_payload := v_payload || jsonb_build_object('qualificationFallback',jsonb_build_object(
      'trigger_type',v_job.trigger_type,'trigger_reference',v_job.trigger_reference,
      'scheduled_at',v_job.scheduled_at,'payload',v_job.payload));
    update public.crm_external_dispatch_queue set scheduled_at=now(),trigger_type='qualified',
      trigger_reference='qualification',payload=v_payload,last_error=null where id=v_job.id;
  else
    insert into public.crm_external_dispatch_queue(id_empresa,crm_lead_id,trigger_type,trigger_reference,scheduled_at,payload)
    values(p_company,p_lead,'qualified','qualification',now(),v_payload);
  end if;
end;
$$;
revoke all on function private.enqueue_qualified_lead(bigint,bigint) from public,anon,authenticated;

create or replace function private.on_lead_qualified()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.qualificado=1 and (tg_op='INSERT' or old.qualificado is distinct from 1) then
    perform private.enqueue_qualified_lead(new.id_empresa,new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.on_lead_qualified() from public,anon,authenticated;
create trigger crm_dispatch_on_qualified after insert or update of qualificado on public.crm_leads
for each row execute function private.on_lead_qualified();

create or replace function private.on_qualified_tag()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_company bigint;
begin
  select l.id_empresa into v_company from public.crm_leads l join public.crm_tags t on t.id=new.tag_id
    and t.id_empresa=l.id_empresa where l.id=new.lead_id and lower(btrim(t.nome))='qualificado';
  if found then perform private.enqueue_qualified_lead(v_company,new.lead_id); end if;
  return new;
end;
$$;
revoke all on function private.on_qualified_tag() from public,anon,authenticated;
create trigger crm_dispatch_on_qualified_tag after insert on public.crm_lead_tags
for each row execute function private.on_qualified_tag();

-- The worker checks the current setting/state, resolves the CV queue and skips
-- already-exported leads. It never interprets a classifier's prose.
create or replace function public.crm_prepare_qualified_dispatch(p_job_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_job public.crm_external_dispatch_queue;
  v_lead public.crm_leads;
  v_settings public.crm_lead_dispatch_settings;
  v_fallback jsonb;
  v_reason text;
  v_payload jsonb;
begin
  select * into v_job from public.crm_external_dispatch_queue where id=p_job_id for update;
  if not found or v_job.status<>'processing' then return jsonb_build_object('action','skip'); end if;
  if v_job.payload->>'enforceQualificationRule' is distinct from 'true' then
    return jsonb_build_object('action','send','payload',v_job.payload);
  end if;
  select * into v_lead from public.crm_leads where id=v_job.crm_lead_id and id_empresa=v_job.id_empresa;
  select * into v_settings from public.crm_lead_dispatch_settings where id_empresa=v_job.id_empresa;
  if exists(select 1 from public.crm_external_crm_send_logs where lead_id=v_job.crm_lead_id and status='sent')
    or exists(select 1 from public.crm_lead_activities where lead_id=v_job.crm_lead_id and tipo='crm_export'
      and (metadata->>'event'='external_crm_sent' or (lower(descricao) like '%lead enviado ao crm%' and lower(descricao) like '%com sucesso%')))
  then v_reason:='already_exported';
  elsif not coalesce(v_settings.send_when_qualified,false) then v_reason:='qualification_dispatch_disabled';
  elsif v_lead.id is null or coalesce(v_lead.qualificado,0)=2 or not (
    coalesce(v_lead.qualificado,0)=1 or exists(select 1 from public.crm_lead_tags lt join public.crm_tags t on t.id=lt.tag_id
      where lt.lead_id=v_lead.id and t.id_empresa=v_lead.id_empresa and lower(btrim(t.nome))='qualificado')
  ) then v_reason:='lead_no_longer_qualified';
  end if;
  if v_reason is not null then
    v_fallback:=v_job.payload->'qualificationFallback';
    if v_reason<>'already_exported' and v_fallback is not null then
      update public.crm_external_dispatch_queue set status='pending',locked_at=null,attempts=0,
        scheduled_at=(v_fallback->>'scheduled_at')::timestamptz,
        trigger_type=v_fallback->>'trigger_type',trigger_reference=v_fallback->>'trigger_reference',
        payload=v_fallback->'payload',last_error=v_reason where id=p_job_id;
      return jsonb_build_object('action','deferred','reason',v_reason);
    end if;
    update public.crm_external_dispatch_queue set status='cancelled',locked_at=null,processed_at=now(),last_error=v_reason where id=p_job_id;
    return jsonb_build_object('action','cancelled','reason',v_reason);
  end if;
  v_payload:=v_job.payload-'qualificationFallback';
  if nullif(btrim(v_settings.cv_distribution_queue_qualified_id),'') is not null then
    v_payload:=v_payload||jsonb_build_object('cvDistributionQueueId',btrim(v_settings.cv_distribution_queue_qualified_id));
  else v_payload:=v_payload-'cvDistributionQueueId'; end if;
  return jsonb_build_object('action','send','payload',v_payload);
end;
$$;
revoke all on function public.crm_prepare_qualified_dispatch(uuid) from public,anon,authenticated;
grant execute on function public.crm_prepare_qualified_dispatch(uuid) to service_role;

create or replace function public.crm_sync_lead_qualification(p_company bigint,p_lead bigint,p_message_id text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_lead public.lead;
  v_crm bigint;
  v_tag public.crm_tags;
  v_old record;
  v_name text;
  v_color text;
  v_actor uuid;
  v_rows integer;
begin
  select * into v_lead from public.lead where id=p_lead and id_empresa=p_company for update;
  if not found or v_lead.qualificado not in (0,1,2) then raise exception 'Invalid qualification/lead'; end if;
  if nullif(p_message_id,'') is null or v_lead.qualificacao_message_id is distinct from p_message_id then
    return jsonb_build_object('qualificacao',v_lead.qualificado,'lead_hub_atualizado',false,'reason','no_current_assessment');
  end if;
  select id into v_crm from public.crm_leads where id_empresa=p_company and lead_id=p_lead order by id limit 1;
  if v_crm is null then v_crm:=public.crm_find_lead_by_phone_alias(p_company,v_lead.numero); end if;
  update public.lead set lead_quente=(qualificado=1),
    interesse_comercial=(qualificado=1 or (qualificado=0 and interesse_comercial)),updated_at=now()
    where id=p_lead returning * into v_lead;
  if v_crm is null then raise exception 'Hub lead not found for qualification'; end if;
  v_name:=case when v_lead.qualificado=1 then 'Qualificado' when v_lead.qualificado=2 then 'Desqualificado'
    when v_lead.interesse_comercial then 'Interesse comercial' end;
  v_color:=case v_lead.qualificado when 1 then '#16A34A' when 2 then '#DC2626' else '#D97706' end;
  v_actor:=public.crm_get_or_create_ai_user(p_company);
  -- Synchronize fields before tags; both changes commit in one transaction.
  update public.crm_leads set qualificado=v_lead.qualificado,lead_quente=v_lead.lead_quente,
    interesse_comercial=v_lead.interesse_comercial,updated_at=now() where id=v_crm and id_empresa=p_company;
  for v_old in select t.id,t.nome from public.crm_lead_tags lt join public.crm_tags t on t.id=lt.tag_id
    where lt.lead_id=v_crm and t.id_empresa=p_company
      and lower(btrim(t.nome)) in ('qualificado','desqualificado','interesse comercial')
      and (v_name is null or lower(btrim(t.nome))<>lower(v_name))
  loop
    delete from public.crm_lead_tags where lead_id=v_crm and tag_id=v_old.id;
    insert into public.crm_lead_activities(lead_id,crm_user_id,tipo,descricao,metadata)
    values(v_crm,v_actor,'tag_remove','Tag removida: '||v_old.nome,
      jsonb_build_object('source','qualification_v2','message_id',v_lead.qualificacao_message_id));
  end loop;
  if v_name is not null then
    select * into v_tag from public.crm_tags where id_empresa=p_company and lower(btrim(nome))=lower(v_name) order by id limit 1;
    if v_tag.id is null then
      insert into public.crm_tags(id_empresa,nome,cor) values(p_company,v_name,v_color) on conflict do nothing;
      select * into v_tag from public.crm_tags where id_empresa=p_company and lower(btrim(nome))=lower(v_name) order by id limit 1;
    end if;
    insert into public.crm_lead_tags(lead_id,tag_id) values(v_crm,v_tag.id) on conflict(lead_id,tag_id) do nothing;
    get diagnostics v_rows=row_count;
    if v_rows>0 then
      insert into public.crm_lead_activities(lead_id,crm_user_id,tipo,descricao,metadata)
      values(v_crm,v_actor,'tag_add','Tag adicionada: '||v_name,jsonb_build_object('source','qualification_v2',
        'message_id',v_lead.qualificacao_message_id,'reason',v_lead.qualificacao_motivo));
    end if;
  end if;
  return jsonb_build_object('qualificacao',v_lead.qualificado,'interesse_comercial',v_lead.interesse_comercial,
    'crm_lead_id',v_crm,'tag_aplicada',v_name,'lead_hub_atualizado',true);
end;
$$;
revoke all on function public.crm_sync_lead_qualification(bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.crm_sync_lead_qualification(bigint,bigint,text) to service_role;

-- Preserve a qualification dispatch when a follow-up enqueues concurrently.
-- Match the existing block explicitly rather than replacing unrelated logic.
do $patch$
declare v_definition text; v_anchor text := E'  if found then\n    update public.crm_external_dispatch_queue q';
begin
  v_definition:=pg_get_functiondef('public.crm_enqueue_external_dispatch(bigint,bigint,timestamptz,text,text,jsonb,integer)'::regprocedure);
  if position(v_anchor in v_definition)=0 then raise exception 'Dispatch enqueue definition changed; review before migrating'; end if;
  v_definition:=replace(v_definition,v_anchor,$replacement$
  if found and v_job.payload->>'enforceQualificationRule'='true' then
    if v_job.status='pending' and coalesce(p_trigger_type,'followup')<>'qualified' then
      update public.crm_external_dispatch_queue set payload=payload||jsonb_build_object(
        'qualificationFallback',jsonb_build_object('trigger_type',p_trigger_type,
        'trigger_reference',p_trigger_reference,'scheduled_at',p_scheduled_at,'payload',p_payload))
      where id=v_job.id returning * into v_job;
    end if;
    return v_job;
  end if;
  if found then
    update public.crm_external_dispatch_queue q$replacement$);
  execute v_definition;
end;
$patch$;
