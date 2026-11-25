-- Use the same company catalog and lead associations that the reports already read.
create function private.attach_conversation_lead_tag(
  p_company bigint, p_contact bigint, p_tag bigint, p_name text
) returns bigint language plpgsql set search_path = '' as $$
declare
  tag_id_found bigint;
  tag_name text := btrim(p_name);
begin
  if not exists(select 1 from public.crm_leads where id=p_contact and id_empresa=p_company) then
    raise exception 'Lead indisponível' using errcode='42501';
  end if;
  if p_tag is null then
    if nullif(tag_name,'') is null then raise exception 'Informe o nome da tag'; end if;
    insert into public.crm_tags(id_empresa,nome) values(p_company,tag_name)
      on conflict (id_empresa,lower(btrim(nome))) do nothing;
    select id into strict tag_id_found from public.crm_tags
      where id_empresa=p_company and lower(btrim(nome))=lower(tag_name) for key share;
  else
    select id into strict tag_id_found from public.crm_tags
      where id=p_tag and id_empresa=p_company for key share;
  end if;
  insert into public.crm_lead_tags(lead_id,tag_id) values(p_contact,tag_id_found)
    on conflict (lead_id,tag_id) do nothing;
  return tag_id_found;
end $$;
revoke all on function private.attach_conversation_lead_tag(bigint,bigint,bigint,text) from public,anon,authenticated;

create function private.tag_completed_template() returns trigger
language plpgsql set search_path = '' as $$
declare
  contact bigint;
  matches bigint;
begin
  -- Resolve the operational lead, preferring the explicit CRM link. External CRM
  -- identifiers may be numeric too, so only use id_crm for companies using Hub.
  select count(*),min(c.id) into matches,contact from public.crm_leads c
    where c.id_empresa=new.id_empresa and c.lead_id=new.lead_id;
  if matches=0 then
    select count(*),min(c.id) into matches,contact from public.lead l
    join public.crm_leads c on c.id_empresa=l.id_empresa and c.id::text=l.id_crm and c.lead_id is null
    where l.id=new.lead_id and l.id_empresa=new.id_empresa and exists(
      select 1 from public.credentials k where k.id_empresa=l.id_empresa and lower(k.default_crm)='hub');
  end if;
  if matches=1 then
    perform private.attach_conversation_lead_tag(new.id_empresa,contact,null,new.receipt#>>'{transport,template_name}');
  end if;
  return new;
end $$;
revoke all on function private.tag_completed_template() from public,anon,authenticated;
create trigger tag_completed_template after update of state on private.hub_conversation_deliveries
  for each row when (new.state='completed' and old.state='accepted'
    and new.receipt#>>'{transport,type}'='template'
    and nullif(btrim(new.receipt#>>'{transport,template_name}'),'') is not null)
  execute function private.tag_completed_template();

create function private.add_conversation_lead_tag(
  p_company bigint,p_lead bigint,p_contact bigint,p_tag bigint,p_name text
) returns bigint language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.crm_current_role() is distinct from 'super_admin'
    or private.hub_native_conversation_id(p_company,p_contact) is distinct from p_lead then
    raise exception 'Sem permissão para adicionar tags nesta conversa' using errcode='42501';
  end if;
  if p_tag is null and (p_name is null or length(btrim(p_name)) not between 1 and 120) then
    raise exception 'Informe um nome de até 120 caracteres' using errcode='22023';
  end if;
  return private.attach_conversation_lead_tag(p_company,p_contact,p_tag,p_name);
end $$;
create function public.hub_add_conversation_lead_tag(
  p_company bigint,p_lead bigint,p_contact bigint,p_tag bigint,p_name text
) returns bigint language sql security invoker set search_path = '' as $$
  select private.add_conversation_lead_tag(p_company,p_lead,p_contact,p_tag,p_name);
$$;
revoke all on function private.add_conversation_lead_tag(bigint,bigint,bigint,bigint,text),
  public.hub_add_conversation_lead_tag(bigint,bigint,bigint,bigint,text) from public,anon,authenticated;
grant execute on function private.add_conversation_lead_tag(bigint,bigint,bigint,bigint,text),
  public.hub_add_conversation_lead_tag(bigint,bigint,bigint,bigint,text) to authenticated;
