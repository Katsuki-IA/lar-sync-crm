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
