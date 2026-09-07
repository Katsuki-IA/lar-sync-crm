-- Finaliza a criacao/sincronizacao do lead operacional em comandos internos
-- separados. Isso evita atualizar a mesma tupla duas vezes dentro do mesmo
-- comando SQL quando triggers de identidade acabaram de restaurar o lead.

create or replace function public.wa_finalize_crm_lead_record(
  p_id_empresa bigint,
  p_wa_user_id text default null,
  p_telefone text default null,
  p_nome text default null,
  p_id_empreendimento bigint default null,
  p_id_crm text default null,
  p_rd_client_id text default null,
  p_wa_parent_user_id text default null,
  p_wa_username text default null
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
  v_lead public.lead%rowtype;
  v_phone text := nullif(
    pg_catalog.regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g'),
    ''
  );
begin
  select r.*
    into v_result
  from public.wa_get_or_create_lead_record(
    p_id_empresa,
    nullif(pg_catalog.btrim(p_wa_user_id), ''),
    v_phone,
    nullif(pg_catalog.btrim(p_nome), ''),
    p_id_empreendimento,
    nullif(pg_catalog.btrim(p_id_crm), ''),
    true,
    (v_phone is null)
  ) r;

  if v_result.lead_id is null then
    return query
    select
      null::jsonb,
      null::bigint,
      false,
      coalesce(v_result.outcome, 'lead_not_resolved')::text,
      v_result.wa_identity_id::uuid,
      v_result.wa_user_id::text,
      v_result.telefone::text,
      v_result.conversation_key::text,
      v_result.legacy_conversation_key::text,
      v_result.active_session_key::text;
    return;
  end if;

  -- Esta atualizacao e uma nova instrucao interna, separada da instrucao que
  -- localizou/criou o lead acima. Portanto, os triggers podem concluir antes
  -- de esta tupla ser enriquecida com os identificadores do CRM.
  update public.lead l
  set
    id_crm = coalesce(nullif(pg_catalog.btrim(p_id_crm), ''), l.id_crm),
    rd_client_id = coalesce(nullif(pg_catalog.btrim(p_rd_client_id), ''), l.rd_client_id),
    id_empreendimento = coalesce(p_id_empreendimento, l.id_empreendimento),
    nome = coalesce(
      nullif(pg_catalog.btrim(l.nome), ''),
      nullif(pg_catalog.btrim(p_nome), ''),
      'Contato WhatsApp'
    ),
    numero = coalesce(nullif(l.numero, ''), v_phone),
    wa_user_id = coalesce(l.wa_user_id, nullif(pg_catalog.btrim(p_wa_user_id), '')),
    wa_parent_user_id = coalesce(
      l.wa_parent_user_id,
      nullif(pg_catalog.btrim(p_wa_parent_user_id), '')
    ),
    wa_username = coalesce(l.wa_username, nullif(pg_catalog.btrim(p_wa_username), '')),
    updated_at = pg_catalog.now()
  where l.id = v_result.lead_id
    and l.id_empresa = p_id_empresa
  returning l.* into v_lead;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'lead resolvido nao pertence a empresa informada';
  end if;

  return query
  select
    pg_catalog.to_jsonb(v_lead),
    v_lead.id,
    v_result.created::boolean,
    v_result.outcome::text,
    coalesce(v_lead.wa_identity_id, v_result.wa_identity_id)::uuid,
    coalesce(v_lead.wa_user_id, v_result.wa_user_id)::text,
    coalesce(nullif(v_lead.numero, ''), v_result.telefone)::text,
    coalesce(v_lead.conversation_key, v_result.conversation_key)::text,
    coalesce(v_lead.legacy_conversation_key, v_result.legacy_conversation_key)::text,
    coalesce(
      v_lead.legacy_conversation_key,
      v_result.legacy_conversation_key,
      v_lead.conversation_key,
      v_result.conversation_key
    )::text;
end;
$$;

comment on function public.wa_finalize_crm_lead_record(
  bigint, text, text, text, bigint, text, text, text, text
) is
  'Localiza ou cria o lead de WhatsApp e conclui o enriquecimento do CRM em uma instrucao interna separada dos triggers.';

revoke all on function public.wa_finalize_crm_lead_record(
  bigint, text, text, text, bigint, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.wa_finalize_crm_lead_record(
  bigint, text, text, text, bigint, text, text, text, text
) to service_role;
