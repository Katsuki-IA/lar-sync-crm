-- Claim exactly the dispatch linked to one single-use pilot authorization.

create or replace function public.claim_authorized_followup_test_v2(
  p_authorization_id uuid,
  p_worker_id text
)
returns setof public.followup_dispatches_v2
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_authorization public.followup_test_authorizations_v2%rowtype;
  v_reason text;
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker_id is required';
  end if;

  select * into v_authorization
  from public.followup_test_authorizations_v2 a
  where a.id = p_authorization_id
  for update;

  if not found
     or v_authorization.status <> 'queued'
     or v_authorization.dispatch_id is null then
    return;
  end if;

  v_reason := public.followup_dispatch_validation_v2(v_authorization.dispatch_id);

  if v_reason is not null then
    if v_reason <> 'outside_send_window' then
      update public.followup_dispatches_v2
         set status = 'cancelled',
             cancellation_reason = v_reason,
             completed_at = now(),
             updated_at = now()
       where id = v_authorization.dispatch_id
         and status = 'queued';
    end if;
    return;
  end if;

  return query
  update public.followup_dispatches_v2 d
     set status = 'claimed',
         claimed_at = now(),
         claimed_by = p_worker_id,
         updated_at = now()
   where d.id = v_authorization.dispatch_id
     and d.id_empresa = v_authorization.id_empresa
     and d.lead_id = v_authorization.lead_id
     and d.sequence_id = v_authorization.sequence_id
     and d.step_id = v_authorization.step_id
     and d.variant_id = v_authorization.variant_id
     and d.status = 'queued'
     and d.dry_run = false
  returning d.*;
end;
$$;

revoke execute on function public.claim_authorized_followup_test_v2(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_authorized_followup_test_v2(uuid, text)
  to service_role;
