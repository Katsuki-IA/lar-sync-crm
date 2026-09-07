create or replace function public.sync_followup_attempt_from_wa_message_v2()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_attempt_id bigint;
  v_dispatch_id bigint;
  v_status_at timestamptz := coalesce(new.status_last_at, now());
begin
  if new.status_current not in ('sent', 'delivered', 'read', 'failed') then
    return new;
  end if;

  select a.id, a.dispatch_id
    into v_attempt_id, v_dispatch_id
  from public.followup_attempts_v2 a
  where a.wa_message_id = new.id
  order by a.id desc
  limit 1;

  if not found then
    return new;
  end if;

  update public.followup_attempts_v2
     set status = new.status_current,
         sent_at = case
           when new.status_current in ('sent', 'delivered', 'read')
             then coalesce(sent_at, new.sent_at, v_status_at)
           else sent_at
         end,
         delivered_at = case
           when new.status_current in ('delivered', 'read')
             then coalesce(delivered_at, new.delivered_at, v_status_at)
           else delivered_at
         end,
         read_at = case
           when new.status_current = 'read'
             then coalesce(read_at, new.read_at, v_status_at)
           else read_at
         end,
         failed_at = case
           when new.status_current = 'failed'
             then coalesce(failed_at, new.failed_at, v_status_at)
           else failed_at
         end,
         error_code = case
           when new.status_current = 'failed' then coalesce(new.error_code, error_code)
           else error_code
         end,
         error_message = case
           when new.status_current = 'failed' then coalesce(new.error_message, error_message)
           else error_message
         end,
         updated_at = now()
   where id = v_attempt_id;

  update public.followup_dispatches_v2
     set status = new.status_current,
         failed_at = case
           when new.status_current = 'failed' then coalesce(failed_at, new.failed_at, v_status_at)
           else failed_at
         end,
         completed_at = case
           when new.status_current in ('delivered', 'read', 'failed')
             then coalesce(completed_at, v_status_at)
           else completed_at
         end,
         updated_at = now()
   where id = v_dispatch_id;

  return new;
end;
$function$;

drop trigger if exists trg_sync_followup_attempt_from_wa_message_v2
  on public.wa_messages;

create trigger trg_sync_followup_attempt_from_wa_message_v2
after update of status_current, status_last_at, sent_at, delivered_at, read_at,
  failed_at, error_code, error_message
on public.wa_messages
for each row
when (
  old.status_current is distinct from new.status_current
  or old.status_last_at is distinct from new.status_last_at
)
execute function public.sync_followup_attempt_from_wa_message_v2();

revoke all on function public.sync_followup_attempt_from_wa_message_v2()
  from public, anon, authenticated;
