-- Centraliza a ativacao/desativacao do atendimento humano para que os fluxos
-- nao dependam exclusivamente do telefone. A resolucao prioriza lead, depois
-- identidade WhatsApp/BSUID e usa o telefone apenas como compatibilidade.

create or replace function public.wa_set_human_attendance(
  p_id_empresa bigint,
  p_lead_id bigint default null,
  p_wa_identity_id uuid default null,
  p_wa_user_id text default null,
  p_telefone text default null,
  p_enabled boolean default true,
  p_status text default null
)
returns table (
  lead_id bigint,
  id_empresa bigint,
  nome text,
  numero text,
  id_crm text,
  wa_identity_id uuid,
  wa_user_id text,
  conversation_key text,
  legacy_conversation_key text,
  active_session_key text,
  atendimento_humano boolean,
  atendimento_humano_desde timestamptz,
  status text,
  resolution_source text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_phone text := nullif(
    pg_catalog.regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g'),
    ''
  );
  v_user_id text := nullif(pg_catalog.btrim(p_wa_user_id), '');
  v_target_id bigint;
  v_source text;
  v_lead public.lead%rowtype;
begin
  if p_id_empresa is null then
    raise exception using
      errcode = '22023',
      message = 'id_empresa obrigatorio para alterar atendimento humano';
  end if;

  -- A trava evita duas tools concorrentes alterarem o mesmo contato em paralelo.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_id_empresa::text || ':human:' || coalesce(
        p_lead_id::text,
        p_wa_identity_id::text,
        v_user_id,
        v_phone,
        'missing'
      ),
      0
    )
  );

  -- 1. O lead explicito sempre vence, desde que pertença a empresa recebida.
  if p_lead_id is not null then
    select l.id, 'lead_id'::text
      into v_target_id, v_source
    from public.lead l
    where l.id = p_lead_id
      and l.id_empresa = p_id_empresa;
  end if;

  -- 2. A identidade explicita pode apontar pelo vinculo da identidade ou do lead.
  if v_target_id is null and p_wa_identity_id is not null then
    select l.id, 'wa_identity_id'::text
      into v_target_id, v_source
    from public.wa_contact_identities i
    join public.lead l
      on l.id_empresa = i.id_empresa
     and (l.id = i.lead_id or l.wa_identity_id = i.id)
    where i.id = p_wa_identity_id
      and i.id_empresa = p_id_empresa
    order by
      case when l.id = i.lead_id then 1 else 2 end,
      l.updated_at desc nulls last,
      l.id desc
    limit 1;
  end if;

  -- 3/4. O resolvedor cobre BSUID atual/alias e, por ultimo, telefone.
  if v_target_id is null and (v_user_id is not null or v_phone is not null) then
    select r.lead_id, r.resolution_source
      into v_target_id, v_source
    from public.wa_resolve_conversation_identity(
      p_id_empresa,
      v_user_id,
      v_phone
    ) r
    where r.lead_id is not null;
  end if;

  if v_target_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'lead nao encontrado para alterar atendimento humano',
      detail = 'Informe lead_id, wa_identity_id, wa_user_id ou telefone pertencente a empresa.';
  end if;

  update public.lead l
  set atendimento_humano = p_enabled,
      atendimento_humano_desde = case when p_enabled then pg_catalog.now() else null end,
      ult_message = case when p_enabled then pg_catalog.now()::text else l.ult_message end,
      status = case
        when p_enabled then coalesce(nullif(pg_catalog.btrim(p_status), ''), 'desativado')
        else coalesce(nullif(pg_catalog.btrim(p_status), ''), l.status)
      end,
      updated_at = pg_catalog.now()
  where l.id = v_target_id
    and l.id_empresa = p_id_empresa
  returning l.* into v_lead;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'lead resolvido deixou de existir antes da atualizacao';
  end if;

  return query
  select
    v_lead.id,
    v_lead.id_empresa,
    v_lead.nome::text,
    nullif(v_lead.numero::text, ''),
    v_lead.id_crm::text,
    v_lead.wa_identity_id,
    v_lead.wa_user_id,
    v_lead.conversation_key,
    v_lead.legacy_conversation_key,
    coalesce(v_lead.legacy_conversation_key, v_lead.conversation_key),
    coalesce(v_lead.atendimento_humano, false),
    v_lead.atendimento_humano_desde,
    v_lead.status,
    coalesce(v_source, 'resolved');
end;
$$;

comment on function public.wa_set_human_attendance(bigint, bigint, uuid, text, text, boolean, text) is
  'Ativa ou libera atendimento humano por lead, identidade WhatsApp, BSUID ou telefone, sempre isolado por empresa.';

revoke all on function public.wa_set_human_attendance(bigint, bigint, uuid, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.wa_set_human_attendance(bigint, bigint, uuid, text, text, boolean, text)
  to service_role;
