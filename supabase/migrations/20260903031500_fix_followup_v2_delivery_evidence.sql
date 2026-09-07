-- Prefer concrete delivery/read timestamps over a stale provider status.
-- This prevents an accepted/sent attempt from becoming a confirmation timeout
-- after the Meta webhook has already supplied delivery evidence.

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
  v_effective_status text;
begin
  v_effective_status := case
    when new.read_at is not null or new.status_current = 'read' then 'read'
    when new.delivered_at is not null or new.status_current = 'delivered' then 'delivered'
    when new.status_current = 'failed' then 'failed'
    when new.sent_at is not null or new.status_current = 'sent' then 'sent'
    else null
  end;

  if v_effective_status is null then
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
     set status = v_effective_status,
         sent_at = case
           when v_effective_status in ('sent', 'delivered', 'read')
             then coalesce(sent_at, new.sent_at, v_status_at)
           else sent_at
         end,
         delivered_at = case
           when v_effective_status in ('delivered', 'read')
             then coalesce(delivered_at, new.delivered_at, v_status_at)
           else delivered_at
         end,
         read_at = case
           when v_effective_status = 'read'
             then coalesce(read_at, new.read_at, v_status_at)
           else read_at
         end,
         failed_at = case
           when v_effective_status = 'failed'
             then coalesce(failed_at, new.failed_at, v_status_at)
           else failed_at
         end,
         error_code = case
           when v_effective_status = 'failed' then coalesce(new.error_code, error_code)
           else error_code
         end,
         error_message = case
           when v_effective_status = 'failed' then coalesce(new.error_message, error_message)
           else error_message
         end,
         updated_at = now()
   where id = v_attempt_id;

  update public.followup_dispatches_v2
     set status = v_effective_status,
         failed_at = case
           when v_effective_status = 'failed' then coalesce(failed_at, new.failed_at, v_status_at)
           else failed_at
         end,
         completed_at = case
           when v_effective_status in ('delivered', 'read', 'failed')
             then coalesce(completed_at, v_status_at)
           else completed_at
         end,
         updated_at = now()
   where id = v_dispatch_id;

  if v_effective_status in ('sent', 'delivered', 'read') then
    perform public.enqueue_followup_crm_event_v2(v_attempt_id, 'sent');
  elsif v_effective_status = 'failed' then
    perform public.enqueue_followup_crm_event_v2(v_attempt_id, 'failed');
  end if;

  return new;
end;
$function$;

create or replace function public.mark_followup_confirmation_timeouts_v2(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_updated integer := 0;
begin
  with candidates as (
    select a.id
    from public.followup_attempts_v2 a
    where a.status in ('accepted', 'sent')
      and a.confirmation_deadline_at <= now()
      and a.delivered_at is null
      and a.read_at is null
      and not exists (
        select 1
        from public.wa_messages w
        where w.id = a.wa_message_id
          and (w.delivered_at is not null or w.read_at is not null)
      )
    order by a.confirmation_deadline_at, a.id
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
    for update of a skip locked
  ),
  updated_attempts as (
    update public.followup_attempts_v2 a
       set status = 'confirmation_timeout',
           updated_at = now()
      from candidates c
     where a.id = c.id
    returning a.dispatch_id
  )
  update public.followup_dispatches_v2 d
     set status = 'confirmation_timeout',
         completed_at = now(),
         updated_at = now()
    from updated_attempts u
   where d.id = u.dispatch_id;

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'confirmation_timeouts', v_updated,
    'automatic_resends', 0,
    'processed_at', now()
  );
end;
$function$;

revoke execute on function public.mark_followup_confirmation_timeouts_v2(integer)
  from public, anon, authenticated;
grant execute on function public.mark_followup_confirmation_timeouts_v2(integer)
  to service_role;

-- Repair historical rows where the provider status remained "sent" even though
-- a delivery/read timestamp was already persisted. The existing trigger then
-- synchronizes the attempt and dispatch without issuing another WhatsApp send.
update public.wa_messages w
   set status_current = case
         when w.read_at is not null then 'read'
         else 'delivered'
       end,
       status_last_at = greatest(
         coalesce(w.status_last_at, '-infinity'::timestamptz),
         coalesce(w.read_at, '-infinity'::timestamptz),
         coalesce(w.delivered_at, '-infinity'::timestamptz)
       ),
       updated_at = now()
 where exists (
   select 1
   from public.followup_attempts_v2 a
   where a.wa_message_id = w.id
     and a.status = 'confirmation_timeout'
 )
   and w.status_current in ('accepted', 'sent')
   and (w.delivered_at is not null or w.read_at is not null);
