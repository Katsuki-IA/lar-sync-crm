-- Libera lead.numero nulo somente quando existe identidade WhatsApp vinculada.
-- A constraint lead_has_phone_or_wa_identity, criada anteriormente, continua
-- impedindo registros sem nenhum identificador utilizavel.

alter table public.lead
  alter column numero drop not null;

comment on column public.lead.numero is
  'Telefone normalizado quando disponibilizado pela Meta ou pelo contato. Pode ser nulo se wa_identity_id estiver preenchido.';

create or replace function public.wa_get_or_create_lead_record(
  p_id_empresa bigint,
  p_wa_user_id text default null,
  p_telefone text default null,
  p_nome text default null,
  p_id_empreendimento bigint default null,
  p_id_crm text default null,
  p_create_if_missing boolean default true,
  p_allow_without_phone boolean default false
)
returns table (
  lead_data jsonb,
  lead_id bigint,
  created boolean,
  outcome text,
  wa_identity_id uuid,
  wa_user_id text,
  telefone text,
  conversation_key text,
  legacy_conversation_key text,
  active_session_key text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result record;
  v_lead_data jsonb;
begin
  select r.* into v_result
  from public.wa_get_or_create_lead(
    p_id_empresa,
    p_wa_user_id,
    p_telefone,
    p_nome,
    p_id_empreendimento,
    p_id_crm,
    p_create_if_missing,
    p_allow_without_phone
  ) r;

  if v_result.lead_id is not null then
    select to_jsonb(l) into v_lead_data
    from public.lead l
    where l.id = v_result.lead_id
      and l.id_empresa = p_id_empresa;
  end if;

  return query
  select
    v_lead_data,
    v_result.lead_id::bigint,
    v_result.created::boolean,
    v_result.outcome::text,
    v_result.wa_identity_id::uuid,
    v_result.wa_user_id::text,
    v_result.telefone::text,
    v_result.conversation_key::text,
    v_result.legacy_conversation_key::text,
    v_result.active_session_key::text;
end;
$$;

comment on function public.wa_get_or_create_lead_record(bigint, text, text, text, bigint, text, boolean, boolean) is
  'Retorna o lead completo, inclusive quando ele acabou de ser criado pela identidade WhatsApp na mesma chamada.';

revoke all on function public.wa_get_or_create_lead_record(bigint, text, text, text, bigint, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.wa_get_or_create_lead_record(bigint, text, text, text, bigint, text, boolean, boolean)
  to service_role;
