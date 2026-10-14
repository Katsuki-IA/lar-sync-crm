CREATE OR REPLACE FUNCTION public.crm_whatsapp_set_conversation_attendance(p_lead_id bigint, p_enabled boolean, p_force boolean DEFAULT false)
 RETURNS TABLE(lead_id bigint, id_empresa bigint, atendimento_humano boolean, atendimento_humano_desde timestamp with time zone, assigned_to uuid, assigned_name text, assigned_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_lead public.lead%rowtype;
  v_previous public.lead%rowtype;
  v_role text := public.crm_current_role();
  v_user_empresa bigint := public.crm_current_empresa_id();
  v_user_id uuid := public.crm_current_user_id();
begin
  if v_role is null or v_user_id is null then
    raise exception using errcode = '42501', message = 'Usuario autenticado do CRM nao encontrado';
  end if;

  select * into v_lead
  from public.lead l
  where l.id = p_lead_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Conversa nao encontrada';
  end if;

  if v_role <> 'super_admin' and v_user_empresa is distinct from v_lead.id_empresa then
    raise exception using errcode = '42501', message = 'Sem permissao para alterar esta conversa';
  end if;

  v_previous := v_lead;

  if p_enabled then
    if v_lead.wa_conversation_assigned_to is not null
       and v_lead.wa_conversation_assigned_to <> v_user_id
       and not (coalesce(p_force, false) and v_role in ('manager', 'super_admin')) then
      raise exception using errcode = '55000', message = 'Esta conversa ja foi assumida por outro atendente';
    end if;

    update public.lead l
    set atendimento_humano = true,
        atendimento_humano_desde = case
          when coalesce(l.atendimento_humano, false) then coalesce(l.atendimento_humano_desde, pg_catalog.now())
          else pg_catalog.now()
        end,
        wa_conversation_assigned_to = v_user_id,
        wa_conversation_assigned_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where l.id = p_lead_id
    returning l.* into v_lead;
  else
    if v_lead.wa_conversation_assigned_to is distinct from v_user_id
       and v_role not in ('manager', 'super_admin') then
      raise exception using errcode = '42501', message = 'Somente o atendente responsavel ou um gestor pode devolver esta conversa para a IA';
    end if;

    update public.lead l
    set atendimento_humano = false,
        atendimento_humano_desde = null,
        wa_conversation_assigned_to = null,
        wa_conversation_assigned_at = null,
        updated_at = pg_catalog.now()
    where l.id = p_lead_id
    returning l.* into v_lead;
  end if;


  -- Audit only genuine assignment/release changes, in the same transaction.
  if coalesce(v_previous.atendimento_humano,false) is distinct from coalesce(v_lead.atendimento_humano,false)
     or v_previous.wa_conversation_assigned_to is distinct from v_lead.wa_conversation_assigned_to then
    insert into public.crm_lead_activities(lead_id,crm_user_id,tipo,descricao,metadata)
    select cl.id,v_user_id,'assignment',
      case when p_enabled then
        coalesce(actor.nome,'Atendente') || ' assumiu a conversa' ||
        case when v_previous.wa_conversation_assigned_to is not null
          and v_previous.wa_conversation_assigned_to <> v_user_id
          then ' anteriormente atendida por ' || coalesce(previous_actor.nome,'outro atendente') else '' end || '.'
      else coalesce(actor.nome,'Atendente') || ' devolveu a conversa para a IA.' end,
      jsonb_build_object('source','hub_conversation_attendance','event',
        case when p_enabled then 'conversation_assumed' else 'conversation_released' end,
        'operational_lead_id',v_lead.id,'previous_assigned_to',v_previous.wa_conversation_assigned_to,
        'assigned_to',v_lead.wa_conversation_assigned_to)
    from public.crm_leads cl
    join public.credentials cred on cred.id_empresa=cl.id_empresa and lower(cred.default_crm)='hub'
    left join public.crm_users actor on actor.id=v_user_id
    left join public.crm_users previous_actor on previous_actor.id=v_previous.wa_conversation_assigned_to
    where cl.id_empresa=v_lead.id_empresa and cl.id::text=v_lead.id_crm;
  end if;

  return query
  select
    v_lead.id,
    v_lead.id_empresa,
    coalesce(v_lead.atendimento_humano, false),
    v_lead.atendimento_humano_desde,
    v_lead.wa_conversation_assigned_to,
    u.nome::text,
    v_lead.wa_conversation_assigned_at
  from public.crm_users u
  where u.id = v_lead.wa_conversation_assigned_to
  union all
  select
    v_lead.id,
    v_lead.id_empresa,
    coalesce(v_lead.atendimento_humano, false),
    v_lead.atendimento_humano_desde,
    null::uuid,
    null::text,
    v_lead.wa_conversation_assigned_at
  where v_lead.wa_conversation_assigned_to is null;
end;
$function$
;
-- Existing active assignments retain their original recorded assignment time.
insert into public.crm_lead_activities(lead_id,crm_user_id,tipo,descricao,metadata,created_at)
select cl.id,l.wa_conversation_assigned_to,'assignment',u.nome || ' assumiu a conversa.',
 jsonb_build_object('source','hub_conversation_attendance','event','conversation_assumed',
 'operational_lead_id',l.id,'assigned_to',u.id,'recovered_from_current_assignment',true),
 l.wa_conversation_assigned_at
from public.lead l
join public.credentials cred on cred.id_empresa=l.id_empresa and lower(cred.default_crm)='hub'
join public.crm_leads cl on cl.id_empresa=l.id_empresa and cl.id::text=l.id_crm
join public.crm_users u on u.id=l.wa_conversation_assigned_to
where l.atendimento_humano=true and l.wa_conversation_assigned_at is not null
and not exists(select 1 from public.crm_lead_activities a where a.lead_id=cl.id
 and a.metadata->>'source'='hub_conversation_attendance'
 and a.metadata->>'event'='conversation_assumed'
 and a.metadata->>'operational_lead_id'=l.id::text
 and a.created_at=l.wa_conversation_assigned_at);

