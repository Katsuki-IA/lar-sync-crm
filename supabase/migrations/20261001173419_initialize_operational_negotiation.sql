create or replace function public.crm_mirror_negotiation()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  update public.lead set tipo_negociacao=new.tipo_negociacao,
    locacao=case when new.tipo_negociacao='locacao' then true
      when new.tipo_negociacao='venda' then false else locacao end
  where id_empresa=new.id_empresa and (id=new.lead_id or (
    id_crm=new.id::text and (
      wa_identity_id=new.wa_identity_id or
      public.crm_phone_match_key(numero)=public.crm_phone_match_key(new.telefone)
    )
  ));
  return new;
end $$;
revoke all on function public.crm_mirror_negotiation() from public;

create or replace function public.crm_initialize_operational_negotiation()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_mode text;
begin
  select c.tipo_negociacao into v_mode from public.crm_leads c
  where c.id_empresa=new.id_empresa and (c.lead_id=new.id or (
    c.id::text=new.id_crm and (c.wa_identity_id=new.wa_identity_id or
      public.crm_phone_match_key(c.telefone)=public.crm_phone_match_key(new.numero))
  )) limit 1;
  if v_mode in ('venda','locacao') then
    new.tipo_negociacao := v_mode;
    new.locacao := v_mode='locacao';
  end if;
  return new;
end $$;
revoke all on function public.crm_initialize_operational_negotiation() from public;
create trigger crm_initialize_operational_negotiation
before insert or update of id_crm on public.lead
for each row execute function public.crm_initialize_operational_negotiation();
