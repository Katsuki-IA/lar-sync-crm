-- Pick a dispatchable follow-up before applying LIMIT 1. Keep stale or
-- paused jobs selectable so the worker can perform its existing cleanup.
do $migration$
declare
  target regprocedure := 'private.kp_claim(text,timestamptz)'::regprocedure;
  definition text := pg_get_functiondef(target);
  ordering text := '   order by x.due_at,x.id for update of x skip locked limit 1 loop';
  eligibility text := $where$
    and (p_kind <> 'followup' or cfg.id_empresa <> 35
      or co.generation <> x.generation or co.status <> 'active' or co.followups_paused
      or exists (select 1 from public.lead l where l.id = co.legacy_lead_id
                 and (l.atendimento_humano or l.wa_conversation_assigned_to is not null))
      or (
        co.first_sent_at is not null
        and (co.last_sent_at is null or co.last_sent_at + interval '1 hour' <= p_now
             or private.kp_is_fast_resume(co.id, x.generation, x.step))
        and not exists (select 1 from private.kp_jobs prior where prior.contact_id = co.id
                        and prior.step < x.step and prior.step <= 3
                        and prior.status not in ('accepted','cancelled'))
        and exists (select 1 from private.kp_templates t where t.id_empresa = cfg.id_empresa
                    and t.step = x.step and t.approved)
      ))
$where$;
begin
  if (select md5(prosrc) from pg_proc where oid = target) <> '69faf6496fdbbca92ce7d510acbcc64a'
     or strpos(definition, ordering) = 0 then
    raise exception 'Unexpected prospect worker definition';
  end if;
  execute replace(definition, ordering, eligibility || ordering);
end;
$migration$;
