-- Keep privileged lookup outside exposed schemas. The public RPC runs as its caller.
alter function public.crm_lead_assignee_options(bigint) set schema private;

create function public.crm_lead_assignee_options(p_id_empresa bigint)
returns table(id uuid,nome text)
language sql stable security invoker set search_path = '' as $function$
  select * from private.crm_lead_assignee_options(p_id_empresa);
$function$;

revoke all on function public.crm_lead_assignee_options(bigint) from public,anon;
grant execute on function public.crm_lead_assignee_options(bigint) to authenticated;
