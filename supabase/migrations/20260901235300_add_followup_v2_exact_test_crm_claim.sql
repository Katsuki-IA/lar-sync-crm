-- Claim exactly one CRM event linked to the single-use pilot authorization.

create or replace function public.claim_authorized_followup_test_crm_event_v2(
  p_authorization_id uuid,
  p_event_id bigint,
  p_worker_id text
)
returns setof public.followup_crm_events_v2
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_authorization public.followup_test_authorizations_v2%rowtype;
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker_id is required';
  end if;

  select * into v_authorization
  from public.followup_test_authorizations_v2 a
  where a.id = p_authorization_id
  for update;

  if not found
     or v_authorization.status <> 'used'
     or v_authorization.dispatch_id is null then
    return;
  end if;

  return query
  update public.followup_crm_events_v2 e
     set status = 'processing',
         claimed_at = now(),
         claimed_by = p_worker_id,
         last_error = null,
         updated_at = now()
   where e.id = p_event_id
     and e.dispatch_id = v_authorization.dispatch_id
     and e.id_empresa = v_authorization.id_empresa
     and e.lead_id = v_authorization.lead_id
     and e.status = 'pending'
  returning e.*;
end;
$$;

revoke execute on function public.claim_authorized_followup_test_crm_event_v2(uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.claim_authorized_followup_test_crm_event_v2(uuid, bigint, text)
  to service_role;
