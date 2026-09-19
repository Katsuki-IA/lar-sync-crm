-- A continuous qualification must survive 24h before CRM dispatch.
alter table public.crm_leads add column qualification_dispatch_started_at timestamptz;

create function private.track_qualification_dispatch_window()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.qualificado=1 then
    if tg_op='INSERT' or old.qualificado is distinct from 1 then
      new.qualification_dispatch_started_at:=now();
    end if;
  else
    new.qualification_dispatch_started_at:=null;
  end if;
  return new;
end;
$$;
revoke all on function private.track_qualification_dispatch_window() from public,anon,authenticated;
create trigger track_qualification_dispatch_window before insert or update of qualificado on public.crm_leads
for each row execute function private.track_qualification_dispatch_window();

create function private.clear_tag_qualification_window()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.crm_tags t where t.id=old.tag_id and lower(btrim(t.nome))='qualificado') then
    update public.crm_leads set qualification_dispatch_started_at=null
      where id=old.lead_id and coalesce(qualificado,0)<>1;
  end if;
  return old;
end;
$$;
revoke all on function private.clear_tag_qualification_window() from public,anon,authenticated;
create trigger clear_tag_qualification_window after delete on public.crm_lead_tags
for each row execute function private.clear_tag_qualification_window();

-- Preserve existing deduplication, CV queue resolution and follow-up fallbacks.
do $patch$
declare d text; old_fragment text;
begin
  d:=pg_get_functiondef('private.enqueue_qualified_lead(bigint,bigint)'::regprocedure);
  old_fragment:='  if not found then return; end if;';
  assert position(old_fragment in d)>0,'enqueue definition changed';
  d:=replace(d,old_fragment,$new$
  if not found or coalesce(v_lead.qualificado,0)=2 then return; end if;
  if v_lead.qualification_dispatch_started_at is null then
    update public.crm_leads set qualification_dispatch_started_at=now()
      where id=p_lead and id_empresa=p_company returning * into v_lead;
  end if;$new$);
  old_fragment:='  if found and (v_job.status=''processing'' or v_job.payload->>''enforceQualificationRule''=''true'') then return; end if;';
  assert position(old_fragment in d)>0,'enqueue deduplication changed';
  d:=replace(d,old_fragment,$new$
  if found and v_job.payload->>'enforceQualificationRule'='true' then
    -- Requalification restarts the clock, but duplicate tag events do not.
    update public.crm_external_dispatch_queue
      set scheduled_at=greatest(scheduled_at,v_lead.qualification_dispatch_started_at+interval '24 hours')
      where id=v_job.id;
    return;
  end if;
  if found and v_job.status='processing' then return; end if;$new$);
  assert position('scheduled_at=now()' in d)>0,'enqueue scheduling changed';
  d:=replace(d,'scheduled_at=now()','scheduled_at=v_lead.qualification_dispatch_started_at+interval ''24 hours''');
  assert position('''qualification'',now(),v_payload' in d)>0,'enqueue insert changed';
  d:=replace(d,'''qualification'',now(),v_payload','''qualification'',v_lead.qualification_dispatch_started_at+interval ''24 hours'',v_payload');
  execute d;

  d:=pg_get_functiondef('public.crm_prepare_qualified_dispatch(uuid)'::regprocedure);
  old_fragment:='elsif v_lead.id is null or coalesce(v_lead.qualificado,0)=2 or not (';
  assert position(old_fragment in d)>0,'prepare qualification check changed';
  d:=replace(d,old_fragment,'elsif v_lead.id is null or v_lead.qualification_dispatch_started_at is null or coalesce(v_lead.qualificado,0)=2 or not (');
  old_fragment:='  v_payload:=v_job.payload-''qualificationFallback'';';
  assert position(old_fragment in d)>0,'prepare payload changed';
  d:=replace(d,old_fragment,$new$
  if now()<v_lead.qualification_dispatch_started_at+interval '24 hours' then
    update public.crm_external_dispatch_queue set status='pending',locked_at=null,
      attempts=greatest(0,attempts-1),
      scheduled_at=v_lead.qualification_dispatch_started_at+interval '24 hours',
      last_error=null where id=p_job_id;
    return jsonb_build_object('action','deferred','reason','qualification_24h_window',
      'eligible_at',v_lead.qualification_dispatch_started_at+interval '24 hours');
  end if;
  v_payload:=v_job.payload-'qualificationFallback';$new$);
  execute d;
end;
$patch$;

-- Unsent legacy jobs have no reliable continuous-qualification timestamp.
-- Start a safe 24h window at deployment, never resend historical exports.
update public.crm_leads l set qualification_dispatch_started_at=now()
where exists(select 1 from public.crm_external_dispatch_queue q where q.crm_lead_id=l.id
  and q.id_empresa=l.id_empresa and q.status='pending' and q.payload->>'enforceQualificationRule'='true')
and coalesce(l.qualificado,0)<>2 and (l.qualificado=1 or exists(
  select 1 from public.crm_lead_tags lt join public.crm_tags t on t.id=lt.tag_id
  where lt.lead_id=l.id and t.id_empresa=l.id_empresa and lower(btrim(t.nome))='qualificado'));
update public.crm_external_dispatch_queue q
set scheduled_at=greatest(q.scheduled_at,l.qualification_dispatch_started_at+interval '24 hours')
from public.crm_leads l where l.id=q.crm_lead_id and l.id_empresa=q.id_empresa
  and q.status='pending' and q.payload->>'enforceQualificationRule'='true'
  and l.qualification_dispatch_started_at is not null;
