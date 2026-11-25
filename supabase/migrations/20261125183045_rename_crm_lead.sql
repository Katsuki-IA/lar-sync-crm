-- Keep edits on the CRM card and its linked WhatsApp conversation atomic.
create function private.rename_crm_lead(p_company bigint, p_contact bigint, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor public.crm_users%rowtype;
  contact public.crm_leads%rowtype;
  native_id bigint;
  matches integer;
  new_name text := btrim(p_name);
begin
  select * into actor from public.crm_users
  where auth_user_id = auth.uid() and active is true;
  if not found or actor.role is null or actor.role not in ('super_admin','manager','gestor','agent','corretor')
     or (actor.role <> 'super_admin' and actor.id_empresa is distinct from p_company) then
    raise exception 'Sem permissão para editar este lead' using errcode = '42501';
  end if;
  if new_name is null or char_length(new_name) not between 1 and 150 or new_name !~ '[^[:space:]]' then
    raise exception 'Informe um nome de até 150 caracteres' using errcode = '22023';
  end if;
  select * into contact from public.crm_leads where id = p_contact and id_empresa = p_company for update;
  if not found or (actor.role in ('agent','corretor') and not exists (
    select 1 from private.hub_agent_crm_lead_ids() allowed(id) where allowed.id = p_contact
  )) then
    raise exception 'Lead indisponível' using errcode = '42501';
  end if;
  native_id := contact.lead_id;
  if native_id is null and exists (
    select 1 from public.credentials where id_empresa = p_company and lower(default_crm) = 'hub'
  ) then
    select count(*), min(id) into matches, native_id from public.lead
    where id_empresa = p_company and id_crm = p_contact::text;
    if matches > 1 then raise exception 'Mais de uma conversa vinculada a este lead' using errcode = 'PT409'; end if;
  end if;
  if native_id is not null then
    if actor.role in ('agent','corretor') and not exists (
      select 1 from private.hub_agent_operational_lead_ids() allowed(id) where allowed.id = native_id
    ) then raise exception 'Conversa indisponível' using errcode = '42501'; end if;
    update public.lead set nome = new_name where id = native_id and id_empresa = p_company;
    if not found then raise exception 'Vínculo de conversa inválido' using errcode = 'PT409'; end if;
  end if;
  update public.crm_leads set nome = new_name where id = p_contact and id_empresa = p_company;
end;
$$;

create function public.hub_rename_crm_lead(p_company bigint, p_contact bigint, p_name text)
returns void language sql security invoker set search_path = '' as $$
  select private.rename_crm_lead(p_company, p_contact, p_name);
$$;

revoke all on function private.rename_crm_lead(bigint,bigint,text), public.hub_rename_crm_lead(bigint,bigint,text) from public, anon;
grant execute on function private.rename_crm_lead(bigint,bigint,text), public.hub_rename_crm_lead(bigint,bigint,text) to authenticated;
