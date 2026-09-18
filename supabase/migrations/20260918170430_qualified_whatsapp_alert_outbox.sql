-- Internal outbox: only NEW successful qualification dispatches create alerts.
-- No historical backfill and no network calls in CRM transactions.
create table private.qualified_whatsapp_alerts (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null unique references public.crm_external_dispatch_queue(id),
  id_empresa bigint not null references public.empresa_dados(id),
  crm_lead_id bigint not null references public.crm_leads(id),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','uncertain','skipped')),
  group_id text,
  lock_token uuid,
  locked_at timestamptz,
  processed_at timestamptz,
  message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  unique(id_empresa,crm_lead_id)
);
alter table private.qualified_whatsapp_alerts enable row level security;
revoke all on private.qualified_whatsapp_alerts from public,anon,authenticated;
create index qualified_whatsapp_alerts_pending_idx on private.qualified_whatsapp_alerts(created_at) where status='pending';

create function private.queue_qualified_whatsapp_alert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='sent' and old.status is distinct from 'sent'
    and new.payload->>'enforceQualificationRule'='true' then
    insert into private.qualified_whatsapp_alerts(dispatch_id,id_empresa,crm_lead_id)
      values(new.id,new.id_empresa,new.crm_lead_id) on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.queue_qualified_whatsapp_alert() from public,anon,authenticated;
create trigger qualified_dispatch_whatsapp_alert after update of status on public.crm_external_dispatch_queue
for each row execute function private.queue_qualified_whatsapp_alert();

create function private.claim_qualified_whatsapp_alerts(p_limit integer default 10)
returns table(alert_id uuid,claim_token uuid,group_id text,lead_name text,lead_phone text,project_name text,lead_id bigint)
language plpgsql security invoker set search_path = '' as $$
declare v_alert private.qualified_whatsapp_alerts; v_group text; v_name text; v_phone text; v_project text;
begin
  -- An interrupted HTTP call can have delivered the message. Do NOT retry it blindly.
  update private.qualified_whatsapp_alerts set status='uncertain',processed_at=now(),
    last_error='Execução interrompida; conferir Evolution antes de reenviar.'
    where status='processing' and locked_at<now()-interval '10 minutes';
  for v_alert in select a.* from private.qualified_whatsapp_alerts a where a.status='pending'
    order by a.created_at limit greatest(1,least(coalesce(p_limit,10),50)) for update skip locked
  loop
    select nullif(btrim(e.id_group),''),l.nome,l.telefone,p.nome into v_group,v_name,v_phone,v_project
      from public.crm_leads l join public.empresa_dados e on e.id=l.id_empresa
      left join public.empreendimento p on p.id=l.id_empreendimento and p.id_empresa=l.id_empresa
      where l.id=v_alert.crm_lead_id and l.id_empresa=v_alert.id_empresa;
    -- The CRM queue must be confirmed sent; pending/failed CRM work never alerts.
    if not exists(select 1 from public.crm_external_dispatch_queue q where q.id=v_alert.dispatch_id
      and q.status='sent' and q.id_empresa=v_alert.id_empresa and q.crm_lead_id=v_alert.crm_lead_id
      and q.payload->>'enforceQualificationRule'='true') then
      update private.qualified_whatsapp_alerts set status='skipped',processed_at=now(),last_error='CRM não confirmado'
        where id=v_alert.id;
      continue;
    end if;
    if v_group is null or v_group !~ '^[0-9-]+@g\.us$' then
      update private.qualified_whatsapp_alerts set status='skipped',processed_at=now(),last_error='Grupo WhatsApp ausente ou inválido'
        where id=v_alert.id;
      continue;
    end if;
    update private.qualified_whatsapp_alerts set status='processing',locked_at=now(),
      lock_token=gen_random_uuid(),group_id=v_group where id=v_alert.id returning * into v_alert;
    alert_id:=v_alert.id; claim_token:=v_alert.lock_token; group_id:=v_group;
    lead_name:=v_name; lead_phone:=v_phone; project_name:=v_project; lead_id:=v_alert.crm_lead_id;
    return next;
  end loop;
end;
$$;
revoke all on function private.claim_qualified_whatsapp_alerts(integer) from public,anon,authenticated;

create function private.finish_qualified_whatsapp_alert(p_id uuid,p_token uuid,p_status text,p_message_id text,p_error text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
  if p_status not in ('sent','failed','uncertain') then raise exception 'Invalid alert result'; end if;
  if p_status='sent' and nullif(btrim(p_message_id),'') is null then raise exception 'Missing Evolution message ID'; end if;
  update private.qualified_whatsapp_alerts set status=p_status,processed_at=now(),
    message_id=nullif(p_message_id,''),last_error=left(p_error,500)
    where id=p_id and lock_token=p_token and status='processing';
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;
revoke all on function private.finish_qualified_whatsapp_alert(uuid,uuid,text,text,text) from public,anon,authenticated;
