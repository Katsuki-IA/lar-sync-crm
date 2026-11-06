-- Aggregate-only endpoint for the two prospect campaigns. No campaign rows exposed.
create or replace function private.hub_kp_funnel_counts(
 p_company_id bigint,p_date_from date,p_date_to date,p_project_id bigint default null,p_type text default 'all'
) returns jsonb language plpgsql stable security definer set search_path='' as $function$
begin
 if auth.uid() is null or not private.crm_can_access_empresa(p_company_id)
  or not exists(select 1 from public.crm_users where auth_user_id=auth.uid() and active and role in ('super_admin','manager','analyst')) then
  raise exception 'Sem permissão para consultar esta empresa' using errcode='42501';
 end if;
 if p_company_id not in (35,36) or p_company_id is null then raise exception 'Empresa fora da prospecção';end if;
 if p_date_from is null or p_date_to is null or p_date_from>p_date_to or p_type is null or p_type not in ('all','inbound','activation') then
  raise exception 'Filtros inválidos';end if;
 if not exists(select 1 from public.hub_company_modules where id_empresa=p_company_id and atendimento_ia) then
  raise exception 'Atendimento IA indisponível' using errcode='42501';end if;
 return (
  select jsonb_build_object('received',count(*),'engaged',count(*) filter(where c.last_reply_at is not null),
   'hot',0,'sentToCrm',count(*) filter(where exists(select 1 from private.kp_handoffs h where h.contact_id=c.id)),
   'scheduled',0)
  from public.crm_leads cl
  left join private.kp_contacts c on c.crm_lead_id=cl.id and c.id_empresa=cl.id_empresa
  left join public.lead l on l.id=cl.lead_id and l.id_empresa=cl.id_empresa
  where cl.id_empresa=p_company_id
   and cl.created_at >= (p_date_from::timestamp at time zone 'America/Sao_Paulo')
   and cl.created_at < ((p_date_to+1)::timestamp at time zone 'America/Sao_Paulo')
   and (p_project_id is null or cl.id_empreendimento=p_project_id)
   and (p_type='all' or (p_type='activation' and (c.id is not null or l.ativacao is true))
    or (p_type='inbound' and c.id is null and l.ativacao is false))
 );
end $function$;
revoke all on function private.hub_kp_funnel_counts(bigint,date,date,bigint,text) from public,anon;
grant execute on function private.hub_kp_funnel_counts(bigint,date,date,bigint,text) to authenticated;
create or replace function public.hub_kp_funnel_counts(
 p_company_id bigint,p_date_from date,p_date_to date,p_project_id bigint default null,p_type text default 'all'
) returns jsonb language sql stable security invoker set search_path='' as $function$
 select private.hub_kp_funnel_counts(p_company_id,p_date_from,p_date_to,p_project_id,p_type);
$function$;
revoke all on function public.hub_kp_funnel_counts(bigint,date,date,bigint,text) from public,anon;
grant execute on function public.hub_kp_funnel_counts(bigint,date,date,bigint,text) to authenticated;

