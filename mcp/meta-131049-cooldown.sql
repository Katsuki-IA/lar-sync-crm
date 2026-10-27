-- 131049 is temporary delivery restriction, never an opt-out.
create table public.wa_marketing_cooldown_events (
 phone_number_id text not null, source_key text not null,
 recipient_key text not null, id_empresa bigint,
 occurred_at timestamptz not null,
 primary key(phone_number_id,source_key)
);
create index wa_marketing_cooldown_company_contact on public.wa_marketing_cooldown_events(id_empresa,recipient_key,occurred_at desc);
create index wa_marketing_cooldown_sender_contact on public.wa_marketing_cooldown_events(phone_number_id,recipient_key,occurred_at desc);
alter table public.wa_marketing_cooldown_events enable row level security;
revoke all on public.wa_marketing_cooldown_events from public,anon,authenticated;
grant select,insert,update on public.wa_marketing_cooldown_events to service_role;

create function public.wa_marketing_cooldown_key(p_recipient text) returns text
language sql immutable set search_path='' as $$
 select case when k ~ '^55[0-9]{2}9[0-9]{8}$' then left(k,4)||substring(k from 6) else k end
 from (select public.wa_marketing_recipient_key(p_recipient) k) s;
$$;

create function public.wa_record_marketing_cooldown(p_phone_number_id text,p_recipient text,p_source_key text,p_event_at timestamptz,p_id_empresa bigint default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_company bigint := p_id_empresa;
begin
 if nullif(btrim(p_phone_number_id),'') is null or public.wa_marketing_cooldown_key(p_recipient) is null or nullif(p_source_key,'') is null then return; end if;
 if v_company is null then
   select min(c.id_empresa) into v_company from public.credentials c
   where c.whatsapp_business_id=p_phone_number_id having count(distinct c.id_empresa)=1;
 end if;
 if v_company is null then
   select m.tenant_id into v_company from public.wa_messages m
   where m.phone_number_id=p_phone_number_id and m.message_id=p_source_key limit 1;
 end if;
 insert into public.wa_marketing_cooldown_events as e(phone_number_id,source_key,recipient_key,id_empresa,occurred_at)
 values(p_phone_number_id,p_source_key,public.wa_marketing_cooldown_key(p_recipient),v_company,least(coalesce(p_event_at,now()),now()))
 on conflict(phone_number_id,source_key) do update
 set occurred_at=least(e.occurred_at,excluded.occurred_at),id_empresa=coalesce(e.id_empresa,excluded.id_empresa);
end; $$;

create function public.wa_marketing_cooldown_until(p_id_empresa bigint,p_phone_number_id text,p_recipient text)
returns timestamptz language sql stable security definer set search_path='' as $$
 with company as (
 select coalesce(p_id_empresa,(select min(c.id_empresa) from public.credentials c where c.whatsapp_business_id=p_phone_number_id having count(distinct c.id_empresa)=1)) id
 )
 select max(e.occurred_at)+interval '24 hours'
 from public.wa_marketing_cooldown_events e cross join company c
 where e.occurred_at>now()-interval '24 hours'
 and (e.id_empresa=c.id or (e.phone_number_id=p_phone_number_id and (c.id is null or e.id_empresa is null)))
 and (e.recipient_key=public.wa_marketing_cooldown_key(p_recipient) or exists (
   select 1 from public.wa_contact_identities i
   where i.id_empresa=coalesce(c.id,e.id_empresa)
   and e.recipient_key in (public.wa_marketing_cooldown_key(i.telefone),public.wa_marketing_cooldown_key(i.wa_user_id),public.wa_marketing_cooldown_key(i.wa_parent_user_id))
   and public.wa_marketing_cooldown_key(p_recipient) in (public.wa_marketing_cooldown_key(i.telefone),public.wa_marketing_cooldown_key(i.wa_user_id),public.wa_marketing_cooldown_key(i.wa_parent_user_id))
 ));
$$;

create function public.wa_capture_marketing_cooldown_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_recipient text;
begin
 if new.status='failed' and coalesce(new.error_code,new.raw#>>'{errors,0,code}')='131049' then
   v_recipient:=coalesce(nullif(new.recipient_id,''),nullif(new.raw->>'recipient_id',''));
   if v_recipient is null then select m.to_wa_id into v_recipient from public.wa_messages m where m.phone_number_id=new.phone_number_id and m.message_id=new.message_id limit 1; end if;
   perform public.wa_record_marketing_cooldown(new.phone_number_id,v_recipient,new.message_id,coalesce(new.timestamp_meta,new.created_at));
 end if;
 return new;
end; $$;
create trigger trg_00_wa_marketing_cooldown after insert on public.wa_message_status_events for each row execute function public.wa_capture_marketing_cooldown_event();

create function public.wa_capture_marketing_cooldown_message() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.direction='outbound' and new.error_code='131049' then
   perform public.wa_record_marketing_cooldown(new.phone_number_id,coalesce(new.to_wa_id,new.to_user_id),coalesce(new.message_id,new.client_message_id),coalesce(new.failed_at,new.status_last_at,new.created_at),new.tenant_id);
 end if;
 return new;
end; $$;
create trigger trg_00_wa_marketing_cooldown_message after insert or update of error_code,to_wa_id,to_user_id,phone_number_id on public.wa_messages for each row execute function public.wa_capture_marketing_cooldown_message();

-- Separate wrapper: existing initial-message opt-out branches must not classify a pause as 131050.
create function public.wa_marketing_cooldown_send_guard(p_phone_number_id text,p_recipient text,p_attempt_id bigint default null)
returns boolean language plpgsql set search_path='' as $$
declare v_until timestamptz; v_dispatch bigint;
begin
 if not public.wa_marketing_send_guard(p_phone_number_id,p_recipient,p_attempt_id) then return false; end if;
 v_until:=public.wa_marketing_cooldown_until(null,p_phone_number_id,p_recipient);
 if v_until is null then return true; end if;
 if p_attempt_id is not null then
   update public.followup_attempts_v2 a set status='cancelled',error_code='marketing_cooldown',error_message='Pausa preventiva de 24 horas após restrição Meta 131049',updated_at=now()
   from public.wa_messages m where a.id=p_attempt_id and a.status='preparing' and m.id=a.wa_message_id and m.message_id is null
     and m.phone_number_id=p_phone_number_id and public.wa_marketing_cooldown_key(m.to_wa_id)=public.wa_marketing_cooldown_key(p_recipient)
   returning a.dispatch_id into v_dispatch;
   update public.followup_dispatches_v2 set status='queued',scheduled_at=greatest(scheduled_at,v_until),claimed_at=null,claimed_by=null,updated_at=now()
   where id=v_dispatch and status in ('claimed','sending');
 end if;
 return false;
end; $$;

revoke all on function public.wa_marketing_cooldown_key(text),public.wa_record_marketing_cooldown(text,text,text,timestamptz,bigint),public.wa_marketing_cooldown_until(bigint,text,text),public.wa_capture_marketing_cooldown_event(),public.wa_capture_marketing_cooldown_message(),public.wa_marketing_cooldown_send_guard(text,text,bigint) from public,anon,authenticated;
grant execute on function public.wa_marketing_cooldown_key(text),public.wa_record_marketing_cooldown(text,text,text,timestamptz,bigint),public.wa_marketing_cooldown_until(bigint,text,text),public.wa_marketing_cooldown_send_guard(text,text,bigint) to service_role;

-- Keep the original error time, including the triggering case; no resend/backlog replay.
select public.wa_record_marketing_cooldown(m.phone_number_id,coalesce(m.to_wa_id,m.to_user_id),coalesce(m.message_id,m.client_message_id),coalesce(m.failed_at,m.status_last_at,m.created_at),m.tenant_id)
from public.wa_messages m where m.direction='outbound' and m.error_code='131049' and coalesce(m.failed_at,m.status_last_at,m.created_at)>now()-interval '24 hours';
