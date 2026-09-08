-- Evita duplicidade quando o mesmo celular brasileiro chega com e sem o
-- nono digito. O valor original continua armazenado para nao alterar o numero
-- usado no envio; esta funcao existe somente para comparacao e locking.

create or replace function public.crm_phone_match_key(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with normalized as (
    select nullif(
      pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'),
      ''
    ) as digits
  )
  select case
    -- +55 DDD 9 + numero movel antigo de oito digitos.
    when digits ~ '^55[1-9][0-9]9[6-9][0-9]{7}$'
      then pg_catalog.substr(digits, 1, 4)
        || pg_catalog.substr(digits, 6)
    -- Mesmo formato sem o codigo do pais.
    when digits ~ '^[1-9][0-9]9[6-9][0-9]{7}$'
      then pg_catalog.substr(digits, 1, 2)
        || pg_catalog.substr(digits, 4)
    else digits
  end
  from normalized;
$$;

comment on function public.crm_phone_match_key(text) is
  'Gera uma chave de comparacao para telefones brasileiros, tratando com e sem o nono digito como o mesmo contato sem modificar o telefone original.';

revoke all on function public.crm_phone_match_key(text)
  from public, anon, authenticated;
grant execute on function public.crm_phone_match_key(text)
  to service_role;

create index if not exists crm_leads_empresa_phone_match_idx
  on public.crm_leads (id_empresa, public.crm_phone_match_key(telefone))
  where public.crm_phone_match_key(telefone) is not null;

create index if not exists lead_empresa_phone_match_idx
  on public.lead (id_empresa, public.crm_phone_match_key(numero))
  where public.crm_phone_match_key(numero) is not null;

create index if not exists wa_identity_empresa_phone_match_idx
  on public.wa_contact_identities (id_empresa, public.crm_phone_match_key(telefone))
  where public.crm_phone_match_key(telefone) is not null;

-- Alem de localizar, esta funcao serializa a decisao localizar/criar. Como a
-- consulta ocorre dentro de uma nova instrucao PL/pgSQL depois do lock, uma
-- chamada concorrente enxerga o lead que acabou de ser confirmado pela outra.
create or replace function public.crm_find_lead_by_phone_alias(
  p_id_empresa bigint,
  p_phone text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone_key text := public.crm_phone_match_key(p_phone);
  v_lead_id bigint;
begin
  if p_id_empresa is null or v_phone_key is null then
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_id_empresa::text || ':phone:' || v_phone_key,
      0
    )
  );

  select lead.id
    into v_lead_id
  from public.crm_leads as lead
  where lead.id_empresa = p_id_empresa
    and public.crm_phone_match_key(lead.telefone) = v_phone_key
  order by lead.created_at asc nulls last, lead.id asc
  limit 1;

  return v_lead_id;
end;
$$;

comment on function public.crm_find_lead_by_phone_alias(bigint, text) is
  'Localiza e trava por empresa a identidade telefonica brasileira usada na decisao atomica de localizar ou criar um lead.';

revoke all on function public.crm_find_lead_by_phone_alias(bigint, text)
  from public, anon, authenticated;
grant execute on function public.crm_find_lead_by_phone_alias(bigint, text)
  to service_role;

-- O resolvedor e usado antes de criar o lead operacional. Com a chave
-- canonica, uma identidade recebida com o nono digito encontra um lead antigo
-- salvo sem ele (e vice-versa).
create or replace function public.wa_resolve_conversation_identity(
  p_id_empresa bigint,
  p_wa_user_id text default null,
  p_telefone text default null
)
returns table (
  id_empresa bigint,
  wa_identity_id uuid,
  wa_user_id text,
  wa_parent_user_id text,
  wa_username text,
  telefone text,
  conversation_key text,
  legacy_conversation_key text,
  active_session_key text,
  lead_id bigint,
  crm_lead_id bigint,
  atendimento_humano boolean,
  resolution_source text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      p_id_empresa as id_empresa,
      nullif(pg_catalog.btrim(p_wa_user_id), '') as wa_user_id,
      nullif(pg_catalog.regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g'), '') as telefone,
      public.crm_phone_match_key(p_telefone) as phone_key
  ),
  identity_candidates as (
    select i.*, 1 as priority, 'bsuid_alias'::text as source
    from params p
    join public.wa_contact_identity_aliases a
      on a.id_empresa = p.id_empresa
     and a.wa_user_id = p.wa_user_id
    join public.wa_contact_identities i
      on i.id = a.wa_identity_id
    where p.wa_user_id is not null

    union all

    select i.*, 2 as priority, 'bsuid_current'::text as source
    from params p
    join public.wa_contact_identities i
      on i.id_empresa = p.id_empresa
     and i.wa_user_id = p.wa_user_id
    where p.wa_user_id is not null

    union all

    select i.*, 3 as priority, 'phone_identity'::text as source
    from params p
    join public.wa_contact_identities i
      on i.id_empresa = p.id_empresa
     and public.crm_phone_match_key(i.telefone) = p.phone_key
    where p.phone_key is not null
  ),
  identity_choice as (
    select c.*
    from identity_candidates c
    order by c.priority, c.last_seen_at desc, c.id
    limit 1
  ),
  lead_choice as (
    select l.*
    from params p
    left join identity_choice i on true
    join public.lead l
      on l.id_empresa = p.id_empresa
     and (
       (i.lead_id is not null and l.id = i.lead_id)
       or (i.id is not null and l.wa_identity_id = i.id)
       or (
         p.phone_key is not null
         and public.crm_phone_match_key(l.numero) = p.phone_key
       )
     )
    order by
      case
        when i.lead_id is not null and l.id = i.lead_id then 1
        when i.id is not null and l.wa_identity_id = i.id then 2
        else 3
      end,
      l.updated_at desc nulls last,
      l.id desc
    limit 1
  ),
  resolved as (
    select
      p.id_empresa,
      i.id as wa_identity_id,
      coalesce(i.wa_user_id, p.wa_user_id, l.wa_user_id) as wa_user_id,
      coalesce(i.wa_parent_user_id, l.wa_parent_user_id) as wa_parent_user_id,
      coalesce(i.username, l.wa_username) as wa_username,
      coalesce(
        p.telefone,
        nullif(pg_catalog.regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g'), ''),
        nullif(pg_catalog.regexp_replace(coalesce(i.telefone, ''), '[^0-9]', '', 'g'), '')
      ) as telefone,
      coalesce(
        l.conversation_key,
        i.conversation_key,
        case when i.id is not null then 'wa:v2:' || i.id::text else null end
      ) as conversation_key,
      coalesce(
        l.legacy_conversation_key,
        case when p.telefone is not null then p.telefone || p.id_empresa::text else null end,
        i.legacy_conversation_key,
        case
          when nullif(pg_catalog.regexp_replace(coalesce(l.numero, ''), '[^0-9]', '', 'g'), '') is not null
            then pg_catalog.regexp_replace(l.numero, '[^0-9]', '', 'g') || p.id_empresa::text
          when nullif(pg_catalog.regexp_replace(coalesce(i.telefone, ''), '[^0-9]', '', 'g'), '') is not null
            then pg_catalog.regexp_replace(i.telefone, '[^0-9]', '', 'g') || p.id_empresa::text
          else null
        end
      ) as legacy_conversation_key,
      l.id as lead_id,
      i.crm_lead_id,
      l.atendimento_humano,
      coalesce(i.source, case when l.id is not null then 'phone_lead' else 'unresolved' end) as resolution_source
    from params p
    left join identity_choice i on true
    left join lead_choice l on true
    where p.id_empresa is not null
  )
  select
    r.id_empresa,
    r.wa_identity_id,
    r.wa_user_id,
    r.wa_parent_user_id,
    r.wa_username,
    r.telefone,
    r.conversation_key,
    r.legacy_conversation_key,
    coalesce(r.legacy_conversation_key, r.conversation_key) as active_session_key,
    r.lead_id,
    r.crm_lead_id,
    r.atendimento_humano,
    r.resolution_source
  from resolved r;
$$;

comment on function public.wa_resolve_conversation_identity(bigint, text, text) is
  'Resolve BSUID/telefone por empresa, inclusive variacoes brasileiras com e sem o nono digito, e preserva a sessao historica.';

revoke all on function public.wa_resolve_conversation_identity(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.wa_resolve_conversation_identity(bigint, text, text)
  to service_role;

-- Preserva a implementacao anterior como nucleo de insercao. O novo ponto de
-- entrada intercepta primeiro um telefone equivalente e so cria quando ele
-- realmente nao existe.
drop function if exists public.crm_ingest_meta_lead_exact_v1(
  bigint, text, text, text, text, text, jsonb, text, text, bigint, bigint, uuid
);

alter function public.crm_ingest_meta_lead(
  bigint, text, text, text, text, text, jsonb, text, text, bigint, bigint, uuid
) rename to crm_ingest_meta_lead_exact_v1;

revoke all on function public.crm_ingest_meta_lead_exact_v1(
  bigint, text, text, text, text, text, jsonb, text, text, bigint, bigint, uuid
) from public, anon, authenticated;
grant execute on function public.crm_ingest_meta_lead_exact_v1(
  bigint, text, text, text, text, text, jsonb, text, text, bigint, bigint, uuid
) to service_role;

create or replace function public.crm_ingest_meta_lead(
  p_id_empresa bigint,
  p_form_id text,
  p_lead_id_meta text,
  p_nome text,
  p_email text,
  p_telefone text,
  p_raw_data jsonb,
  p_origem text,
  p_observacoes text,
  p_id_empreendimento bigint,
  p_crm_stage_id bigint,
  p_crm_assigned_to uuid
)
returns table(created_lead_id bigint, was_inserted boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone_key text := public.crm_phone_match_key(p_telefone);
  v_lead_id bigint;
  v_meta_row_id uuid;
begin
  if v_phone_key is not null then
    v_lead_id := public.crm_find_lead_by_phone_alias(p_id_empresa, p_telefone);
  else
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_id_empresa::text || ':meta:' || p_lead_id_meta,
        0
      )
    );
  end if;

  if v_lead_id is null then
    return query
    select result.created_lead_id, result.was_inserted
    from public.crm_ingest_meta_lead_exact_v1(
      p_id_empresa,
      p_form_id,
      p_lead_id_meta,
      p_nome,
      p_email,
      p_telefone,
      p_raw_data,
      p_origem,
      p_observacoes,
      p_id_empreendimento,
      p_crm_stage_id,
      p_crm_assigned_to
    ) result;
    return;
  end if;

  insert into public.crm_meta_leads as target (
    id_empresa,
    form_id,
    lead_id_meta,
    nome,
    email,
    telefone,
    raw_data,
    crm_lead_id
  ) values (
    p_id_empresa,
    p_form_id,
    p_lead_id_meta,
    p_nome,
    p_email,
    p_telefone,
    p_raw_data,
    v_lead_id
  )
  on conflict (lead_id_meta) do update
  set crm_lead_id = coalesce(target.crm_lead_id, excluded.crm_lead_id)
  returning id, crm_lead_id into v_meta_row_id, v_lead_id;

  update public.crm_leads
  set
    email = case
      when coalesce(pg_catalog.btrim(email), '') = ''
       and coalesce(pg_catalog.btrim(p_email), '') <> '' then p_email
      else email
    end,
    updated_at = pg_catalog.now()
  where id = v_lead_id;

  insert into public.crm_lead_activities (
    lead_id,
    crm_user_id,
    tipo,
    descricao,
    metadata
  ) values (
    v_lead_id,
    null,
    'meta_resubmission',
    'Novo cadastro recebido via Meta',
    pg_catalog.jsonb_build_object(
      'source', 'meta_webhook',
      'meta_lead_id', p_lead_id_meta,
      'form_id', p_form_id,
      'duplicate_phone', true,
      'phone_alias_match', true,
      'received_empreendimento_id', p_id_empreendimento
    )
  );

  perform public.crm_record_lead_attribution(
    p_crm_lead_id => v_lead_id,
    p_id_empresa => p_id_empresa,
    p_source_type => 'meta',
    p_meta_form_id => p_form_id,
    p_meta_page_id => p_raw_data #>> '{webhook,value,page_id}',
    p_meta_leadgen_id => p_lead_id_meta,
    p_meta_ad_id => coalesce(p_raw_data #>> '{lead,ad_id}', p_raw_data #>> '{webhook,value,ad_id}'),
    p_meta_adset_id => p_raw_data #>> '{webhook,value,adgroup_id}',
    p_raw_data => coalesce(p_raw_data, '{}'::jsonb)
  );

  return query select v_lead_id, false;
end;
$$;

comment on function public.crm_ingest_meta_lead(
  bigint, text, text, text, text, text, jsonb, text, text, bigint, bigint, uuid
) is
  'Ingere lead da Meta reutilizando o lead existente da empresa quando o telefone brasileiro difere apenas pelo nono digito.';

revoke all on function public.crm_ingest_meta_lead(
  bigint, text, text, text, text, text, jsonb, text, text, bigint, bigint, uuid
) from public, anon, authenticated;
grant execute on function public.crm_ingest_meta_lead(
  bigint, text, text, text, text, text, jsonb, text, text, bigint, bigint, uuid
) to service_role;
