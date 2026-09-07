create table if not exists public.followup_crm_events_v2 (
  id bigint generated always as identity primary key,
  id_empresa bigint not null references public.empresa_dados(id),
  lead_id bigint not null references public.lead(id),
  dispatch_id bigint not null references public.followup_dispatches_v2(id),
  attempt_id bigint not null references public.followup_attempts_v2(id),
  wa_message_id uuid not null references public.wa_messages(id),
  event_type text not null check (event_type in ('sent', 'failed')),
  crm_provider text,
  subject text not null,
  message_body text not null,
  crm_stage_id text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  claimed_at timestamptz,
  claimed_by text,
  processed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, event_type)
);

create index if not exists followup_crm_events_v2_pending_idx
  on public.followup_crm_events_v2 (status, created_at, id)
  where status = 'pending';

create index if not exists followup_crm_events_v2_lead_idx
  on public.followup_crm_events_v2 (lead_id, created_at desc);

alter table public.followup_crm_events_v2 enable row level security;

revoke all on table public.followup_crm_events_v2
  from public, anon, authenticated;
grant select, insert, update, delete on table public.followup_crm_events_v2
  to service_role;
grant usage, select on sequence public.followup_crm_events_v2_id_seq
  to service_role;

drop trigger if exists trg_followup_crm_events_v2_updated_at
  on public.followup_crm_events_v2;
create trigger trg_followup_crm_events_v2_updated_at
before update on public.followup_crm_events_v2
for each row execute function public.set_updated_at();

create or replace function public.enqueue_followup_crm_event_v2(
  p_attempt_id bigint,
  p_event_type text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_attempt public.followup_attempts_v2%rowtype;
  v_dispatch public.followup_dispatches_v2%rowtype;
  v_message public.wa_messages%rowtype;
  v_event_id bigint;
  v_step_order integer;
  v_subject text;
  v_body text;
begin
  if p_event_type not in ('sent', 'failed') then
    return jsonb_build_object('enqueued', false, 'reason', 'unsupported_event_type');
  end if;

  select * into v_attempt
  from public.followup_attempts_v2
  where id = p_attempt_id;

  if not found then
    return jsonb_build_object('enqueued', false, 'reason', 'attempt_not_found');
  end if;

  select * into v_dispatch
  from public.followup_dispatches_v2
  where id = v_attempt.dispatch_id;

  select * into v_message
  from public.wa_messages
  where id = v_attempt.wa_message_id;

  select s.step_order into v_step_order
  from public.followup_steps_v2 s
  where s.id = v_dispatch.step_id;

  if p_event_type = 'sent' then
    v_subject := concat('Follow-up ', coalesce(v_step_order::text, ''), ' enviado');
    v_body :=
      '[AUTOMAÇÃO WHATSAPP]' || chr(10) || chr(10) ||
      'Follow-up enviado com sucesso pela API da Meta.' || chr(10) || chr(10) ||
      'Mensagem enviada ao lead:' || chr(10) ||
      '--------------------------------' || chr(10) ||
      coalesce(v_message.text_body, v_dispatch.rendered_crm_message, '—');
  else
    v_subject := concat('Falha no follow-up ', coalesce(v_step_order::text, ''));
    v_body :=
      '[AUTOMAÇÃO WHATSAPP]' || chr(10) || chr(10) ||
      'Falha no envio do follow-up pela API da Meta.' || chr(10) ||
      'A mensagem não foi entregue ao lead.' || chr(10) || chr(10) ||
      'Motivo da falha:' || chr(10) ||
      '--------------------------------' || chr(10) ||
      coalesce(v_message.error_message, v_attempt.error_message, 'Motivo não informado pela Meta.');
  end if;

  insert into public.followup_crm_events_v2 (
    id_empresa,
    lead_id,
    dispatch_id,
    attempt_id,
    wa_message_id,
    event_type,
    crm_provider,
    subject,
    message_body,
    crm_stage_id,
    metadata
  ) values (
    v_dispatch.id_empresa,
    v_dispatch.lead_id,
    v_dispatch.id,
    v_attempt.id,
    v_message.id,
    p_event_type,
    v_message.crm_provider,
    v_subject,
    v_body,
    case
      when p_event_type = 'sent'
        then nullif(v_dispatch.context_snapshot ->> 'id_situacao', '')
      else null
    end,
    jsonb_build_object(
      'source', 'followup_v2',
      'meta_message_id', v_attempt.meta_message_id,
      'error_code', v_message.error_code,
      'template_name', v_message.template_name,
      'step_order', v_step_order
    )
  )
  on conflict (attempt_id, event_type) do update
    set message_body = excluded.message_body,
        metadata = public.followup_crm_events_v2.metadata || excluded.metadata,
        updated_at = now()
  returning id into v_event_id;

  return jsonb_build_object(
    'enqueued', true,
    'event_id', v_event_id,
    'event_type', p_event_type
  );
end;
$function$;

create or replace function public.claim_followup_crm_events_v2(
  p_worker_id text,
  p_limit integer default 10
)
returns setof public.followup_crm_events_v2
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker_id is required';
  end if;

  return query
  with candidates as (
    select e.id
    from public.followup_crm_events_v2 e
    where e.status = 'pending'
    order by e.created_at, e.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.followup_crm_events_v2 e
     set status = 'processing',
         claimed_at = now(),
         claimed_by = p_worker_id,
         last_error = null,
         updated_at = now()
    from candidates
   where e.id = candidates.id
  returning e.*;
end;
$function$;

create or replace function public.complete_followup_crm_event_v2(
  p_event_id bigint,
  p_worker_id text,
  p_success boolean,
  p_error text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event public.followup_crm_events_v2%rowtype;
begin
  update public.followup_crm_events_v2
     set status = case when coalesce(p_success, false) then 'completed' else 'failed' end,
         processed_at = now(),
         last_error = case when coalesce(p_success, false) then null else nullif(p_error, '') end,
         updated_at = now()
   where id = p_event_id
     and status = 'processing'
     and claimed_by = p_worker_id
  returning * into v_event;

  if not found then
    return jsonb_build_object('completed', false, 'reason', 'event_not_claimed_by_worker');
  end if;

  update public.wa_messages
     set crm_sync_status = case
           when coalesce(p_success, false) then 'processed'
           else 'failed'
         end,
         crm_synced_at = case
           when coalesce(p_success, false) then now()
           else crm_synced_at
         end,
         crm_sync_error = case
           when coalesce(p_success, false) then null
           else nullif(p_error, '')
         end,
         updated_at = now()
   where id = v_event.wa_message_id;

  if coalesce(p_success, false) then
    update public.followup_attempts_v2
       set crm_delivery_notified_at = case
             when v_event.event_type = 'sent'
               then coalesce(crm_delivery_notified_at, now())
             else crm_delivery_notified_at
           end,
           crm_failure_notified_at = case
             when v_event.event_type = 'failed'
               then coalesce(crm_failure_notified_at, now())
             else crm_failure_notified_at
           end,
           updated_at = now()
     where id = v_event.attempt_id;
  end if;

  return jsonb_build_object(
    'completed', true,
    'event_id', v_event.id,
    'status', case when coalesce(p_success, false) then 'completed' else 'failed' end
  );
end;
$function$;

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

  if new.status_current in ('sent', 'failed') then
    perform public.enqueue_followup_crm_event_v2(v_attempt_id, new.status_current);
  end if;

  return new;
end;
$function$;

revoke all on function public.enqueue_followup_crm_event_v2(bigint, text)
  from public, anon, authenticated;
revoke all on function public.claim_followup_crm_events_v2(text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_followup_crm_event_v2(bigint, text, boolean, text)
  from public, anon, authenticated;

grant execute on function public.enqueue_followup_crm_event_v2(bigint, text)
  to service_role;
grant execute on function public.claim_followup_crm_events_v2(text, integer)
  to service_role;
grant execute on function public.complete_followup_crm_event_v2(bigint, text, boolean, text)
  to service_role;
