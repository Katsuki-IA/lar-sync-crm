-- Hub automatic qualification only. Explicit broker handoff and follow-ups are unchanged.
alter table public.crm_lead_dispatch_settings
  add column qualification_wait_hours integer not null default 24
  check (qualification_wait_hours between 1 and 168);

create function private.qualified_dispatch_wait(p_company bigint)
returns interval language sql stable security invoker set search_path='' as $$
  select make_interval(hours => coalesce((select qualification_wait_hours
    from public.crm_lead_dispatch_settings where id_empresa=p_company),24));
$$;
revoke all on function private.qualified_dispatch_wait(bigint) from public,anon,authenticated;
grant execute on function private.qualified_dispatch_wait(bigint) to service_role;

-- Patch only qualified dispatch functions; fail closed on unexpected definition drift.
do $patch$
declare fn text; d text; old text; company text; expected integer;
begin
  for fn,old,company,expected in select * from (values
    ('private.enqueue_qualified_lead(bigint,bigint)','v_lead.qualification_dispatch_started_at', 'p_company',3),
    ('public.crm_prepare_qualified_dispatch(uuid)','v_lead.qualification_dispatch_started_at','v_job.id_empresa',3),
    ('private.claim_qualified_whatsapp_alerts(integer)','cl.qualification_dispatch_started_at','cl.id_empresa',2)
  ) as patches(signature,anchor,company_id,occurrences)
  loop
    d:=pg_get_functiondef(fn::regprocedure);
    old:=old||'+interval ''24 hours''';
    if (length(d)-length(replace(d,old,'')))/length(old)<>expected then
      raise exception 'Unexpected qualification window definition: %',fn;
    end if;
    d:=replace(d,old,split_part(old,'+',1)||'+private.qualified_dispatch_wait('||company||')');
    d:=replace(d,'''qualification_24h_window''','''qualification_wait_window''');
    execute d;
  end loop;
end $patch$;

create function private.reschedule_qualified_dispatch_wait()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.qualification_wait_hours is not distinct from old.qualification_wait_hours then return new; end if;
  end if;
  -- Never reclaim processing jobs, revive failures, resend completed jobs or change fallbacks.
  update public.crm_external_dispatch_queue q
    set scheduled_at=l.qualification_dispatch_started_at+make_interval(hours=>new.qualification_wait_hours)
    from public.crm_leads l
    where q.id_empresa=new.id_empresa and l.id_empresa=q.id_empresa and l.id=q.crm_lead_id
      and q.status='pending' and q.payload->>'enforceQualificationRule'='true'
      and l.qualificado=1 and l.qualification_dispatch_started_at is not null;
  return new;
end $$;
revoke all on function private.reschedule_qualified_dispatch_wait() from public,anon,authenticated;
create trigger reschedule_qualified_dispatch_wait
after insert or update of qualification_wait_hours on public.crm_lead_dispatch_settings
for each row execute function private.reschedule_qualified_dispatch_wait();
