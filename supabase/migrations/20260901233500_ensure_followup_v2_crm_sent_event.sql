create or replace function public.ensure_followup_crm_sent_event_v2()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_attempt_id bigint;
begin
  if new.status_current not in ('delivered', 'read') then
    return new;
  end if;

  select a.id into v_attempt_id
  from public.followup_attempts_v2 a
  where a.wa_message_id = new.id
  order by a.id desc
  limit 1;

  if found then
    perform public.enqueue_followup_crm_event_v2(v_attempt_id, 'sent');
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_ensure_followup_crm_sent_event_v2
  on public.wa_messages;

create trigger trg_ensure_followup_crm_sent_event_v2
after update of status_current, status_last_at
on public.wa_messages
for each row
when (
  new.status_current in ('delivered', 'read')
  and (
    old.status_current is distinct from new.status_current
    or old.status_last_at is distinct from new.status_last_at
  )
)
execute function public.ensure_followup_crm_sent_event_v2();

revoke all on function public.ensure_followup_crm_sent_event_v2()
  from public, anon, authenticated;
