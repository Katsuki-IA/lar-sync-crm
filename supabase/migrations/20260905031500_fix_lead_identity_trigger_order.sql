-- O preenchimento dos campos do lead precisa ocorrer antes do INSERT, mas a
-- identidade somente pode receber lead_id depois que a linha do lead existir.

create or replace function public.wa_sync_lead_contact_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_identity public.wa_contact_identities%rowtype;
  v_phone text;
begin
  if new.wa_identity_id is null then
    return new;
  end if;

  select i.* into v_identity
  from public.wa_contact_identities i
  where i.id = new.wa_identity_id
    and i.id_empresa = new.id_empresa;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'wa_identity_id não pertence à empresa do lead';
  end if;

  v_phone := nullif(regexp_replace(coalesce(new.numero, ''), '[^0-9]', '', 'g'), '');

  new.wa_user_id := coalesce(new.wa_user_id, v_identity.wa_user_id);
  new.wa_parent_user_id := coalesce(new.wa_parent_user_id, v_identity.wa_parent_user_id);
  new.wa_username := coalesce(new.wa_username, v_identity.username);
  new.conversation_key := coalesce(
    new.conversation_key,
    v_identity.conversation_key,
    'wa:v2:' || new.wa_identity_id::text
  );
  new.legacy_conversation_key := coalesce(
    case when v_phone is not null then v_phone || new.id_empresa::text else null end,
    new.legacy_conversation_key,
    v_identity.legacy_conversation_key
  );

  return new;
end;
$$;

create or replace function public.wa_link_lead_contact_identity_after_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.wa_identity_id is distinct from new.wa_identity_id
     and old.wa_identity_id is not null then
    update public.wa_contact_identities i
    set lead_id = null,
        updated_at = now()
    where i.id = old.wa_identity_id
      and i.lead_id = old.id;
  end if;

  if new.wa_identity_id is not null then
    update public.wa_contact_identities i
    set lead_id = new.id,
        conversation_key = new.conversation_key,
        legacy_conversation_key = new.legacy_conversation_key,
        updated_at = now()
    where i.id = new.wa_identity_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_wa_link_lead_contact_identity_after_write on public.lead;
create trigger trg_wa_link_lead_contact_identity_after_write
after insert or update of wa_identity_id on public.lead
for each row execute function public.wa_link_lead_contact_identity_after_write();

revoke all on function public.wa_sync_lead_contact_identity() from public, anon, authenticated;
revoke all on function public.wa_link_lead_contact_identity_after_write() from public, anon, authenticated;
