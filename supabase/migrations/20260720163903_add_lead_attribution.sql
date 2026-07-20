create table if not exists public.crm_lead_attribution (
  id uuid primary key default gen_random_uuid(),
  crm_lead_id bigint not null references public.crm_leads(id) on delete cascade,
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  source_type text not null,
  source_id uuid null references public.crm_site_lead_sources(id) on delete set null,
  meta_form_id text null,
  meta_page_id text null,
  meta_leadgen_id text null,
  meta_ad_id text null,
  meta_adset_id text null,
  meta_campaign_id text null,
  utm_source text null,
  utm_medium text null,
  utm_campaign text null,
  utm_content text null,
  utm_term text null,
  utm_id text null,
  utm_adgroup text null,
  utm_ad text null,
  gclid text null,
  gbraid text null,
  wbraid text null,
  fbclid text null,
  landing_page_url text null,
  referrer_url text null,
  user_agent text null,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_lead_attribution_source_type_check check (length(trim(source_type)) > 0)
);

create index if not exists idx_crm_lead_attribution_lead
  on public.crm_lead_attribution (crm_lead_id);

create index if not exists idx_crm_lead_attribution_empresa_created
  on public.crm_lead_attribution (id_empresa, created_at desc);

create index if not exists idx_crm_lead_attribution_utm
  on public.crm_lead_attribution (id_empresa, utm_source, utm_campaign);

create unique index if not exists idx_crm_lead_attribution_meta_lead
  on public.crm_lead_attribution (id_empresa, meta_leadgen_id)
  where meta_leadgen_id is not null;

drop trigger if exists set_updated_at on public.crm_lead_attribution;
create trigger set_updated_at
before update on public.crm_lead_attribution
for each row execute function public.handle_updated_at();

alter table public.crm_lead_attribution enable row level security;
revoke all on table public.crm_lead_attribution from anon, authenticated;
grant all on table public.crm_lead_attribution to service_role;

create or replace function public.crm_extract_attribution_value(
  p_raw_data jsonb,
  p_keys text[]
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_value text;
begin
  foreach v_key in array p_keys loop
    v_value := nullif(trim(coalesce(
      p_raw_data #>> array['fields', v_key],
      p_raw_data #>> array['payload', v_key]
    )), '');
    if v_value is not null then
      return v_value;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.crm_record_lead_attribution(
  p_crm_lead_id bigint,
  p_id_empresa bigint,
  p_source_type text,
  p_source_id uuid default null,
  p_meta_form_id text default null,
  p_meta_page_id text default null,
  p_meta_leadgen_id text default null,
  p_meta_ad_id text default null,
  p_meta_adset_id text default null,
  p_meta_campaign_id text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_content text default null,
  p_utm_term text default null,
  p_utm_id text default null,
  p_utm_adgroup text default null,
  p_utm_ad text default null,
  p_gclid text default null,
  p_gbraid text default null,
  p_wbraid text default null,
  p_fbclid text default null,
  p_landing_page_url text default null,
  p_referrer_url text default null,
  p_user_agent text default null,
  p_raw_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_source_type text;
begin
  v_source_type := nullif(lower(trim(p_source_type)), '');
  if v_source_type is null then
    raise exception 'Tipo da origem obrigatório';
  end if;

  if not exists (
    select 1
    from public.crm_leads lead
    where lead.id = p_crm_lead_id
      and lead.id_empresa = p_id_empresa
  ) then
    raise exception 'Lead inválido para a empresa';
  end if;

  select attribution.id
    into v_id
  from public.crm_lead_attribution attribution
  where attribution.id_empresa = p_id_empresa
    and (
      (
        p_meta_leadgen_id is not null
        and attribution.meta_leadgen_id = p_meta_leadgen_id
      )
      or (
        p_source_id is not null
        and attribution.crm_lead_id = p_crm_lead_id
        and attribution.source_type = v_source_type
        and attribution.source_id = p_source_id
      )
      or (
        p_source_id is null
        and p_meta_leadgen_id is null
        and attribution.crm_lead_id = p_crm_lead_id
        and attribution.source_type = v_source_type
        and attribution.source_id is null
        and attribution.meta_leadgen_id is null
      )
    )
  order by attribution.created_at asc
  limit 1
  for update;

  if v_id is not null then
    update public.crm_lead_attribution attribution
    set
      source_id = coalesce(p_source_id, attribution.source_id),
      meta_form_id = coalesce(nullif(trim(p_meta_form_id), ''), attribution.meta_form_id),
      meta_page_id = coalesce(nullif(trim(p_meta_page_id), ''), attribution.meta_page_id),
      meta_leadgen_id = coalesce(nullif(trim(p_meta_leadgen_id), ''), attribution.meta_leadgen_id),
      meta_ad_id = coalesce(nullif(trim(p_meta_ad_id), ''), attribution.meta_ad_id),
      meta_adset_id = coalesce(nullif(trim(p_meta_adset_id), ''), attribution.meta_adset_id),
      meta_campaign_id = coalesce(nullif(trim(p_meta_campaign_id), ''), attribution.meta_campaign_id),
      utm_source = coalesce(nullif(trim(p_utm_source), ''), attribution.utm_source),
      utm_medium = coalesce(nullif(trim(p_utm_medium), ''), attribution.utm_medium),
      utm_campaign = coalesce(nullif(trim(p_utm_campaign), ''), attribution.utm_campaign),
      utm_content = coalesce(nullif(trim(p_utm_content), ''), attribution.utm_content),
      utm_term = coalesce(nullif(trim(p_utm_term), ''), attribution.utm_term),
      utm_id = coalesce(nullif(trim(p_utm_id), ''), attribution.utm_id),
      utm_adgroup = coalesce(nullif(trim(p_utm_adgroup), ''), attribution.utm_adgroup),
      utm_ad = coalesce(nullif(trim(p_utm_ad), ''), attribution.utm_ad),
      gclid = coalesce(nullif(trim(p_gclid), ''), attribution.gclid),
      gbraid = coalesce(nullif(trim(p_gbraid), ''), attribution.gbraid),
      wbraid = coalesce(nullif(trim(p_wbraid), ''), attribution.wbraid),
      fbclid = coalesce(nullif(trim(p_fbclid), ''), attribution.fbclid),
      landing_page_url = coalesce(nullif(trim(p_landing_page_url), ''), attribution.landing_page_url),
      referrer_url = coalesce(nullif(trim(p_referrer_url), ''), attribution.referrer_url),
      user_agent = coalesce(nullif(trim(p_user_agent), ''), attribution.user_agent),
      raw_data = coalesce(attribution.raw_data, '{}'::jsonb) || coalesce(p_raw_data, '{}'::jsonb),
      updated_at = now()
    where attribution.id = v_id;

    return v_id;
  end if;

  insert into public.crm_lead_attribution (
    crm_lead_id,
    id_empresa,
    source_type,
    source_id,
    meta_form_id,
    meta_page_id,
    meta_leadgen_id,
    meta_ad_id,
    meta_adset_id,
    meta_campaign_id,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    utm_id,
    utm_adgroup,
    utm_ad,
    gclid,
    gbraid,
    wbraid,
    fbclid,
    landing_page_url,
    referrer_url,
    user_agent,
    raw_data
  ) values (
    p_crm_lead_id,
    p_id_empresa,
    v_source_type,
    p_source_id,
    nullif(trim(p_meta_form_id), ''),
    nullif(trim(p_meta_page_id), ''),
    nullif(trim(p_meta_leadgen_id), ''),
    nullif(trim(p_meta_ad_id), ''),
    nullif(trim(p_meta_adset_id), ''),
    nullif(trim(p_meta_campaign_id), ''),
    nullif(trim(p_utm_source), ''),
    nullif(trim(p_utm_medium), ''),
    nullif(trim(p_utm_campaign), ''),
    nullif(trim(p_utm_content), ''),
    nullif(trim(p_utm_term), ''),
    nullif(trim(p_utm_id), ''),
    nullif(trim(p_utm_adgroup), ''),
    nullif(trim(p_utm_ad), ''),
    nullif(trim(p_gclid), ''),
    nullif(trim(p_gbraid), ''),
    nullif(trim(p_wbraid), ''),
    nullif(trim(p_fbclid), ''),
    nullif(trim(p_landing_page_url), ''),
    nullif(trim(p_referrer_url), ''),
    nullif(trim(p_user_agent), ''),
    coalesce(p_raw_data, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.crm_record_lead_attribution(
  bigint, bigint, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.crm_record_lead_attribution(
  bigint, bigint, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, jsonb
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
  v_meta_row_id uuid;
  v_lead_id bigint;
begin
  insert into public.crm_meta_leads (
    id_empresa,
    form_id,
    lead_id_meta,
    nome,
    email,
    telefone,
    raw_data
  ) values (
    p_id_empresa,
    p_form_id,
    p_lead_id_meta,
    p_nome,
    p_email,
    p_telefone,
    p_raw_data
  )
  on conflict (lead_id_meta) do nothing
  returning id into v_meta_row_id;

  if v_meta_row_id is null then
    select meta_lead.crm_lead_id
      into v_lead_id
    from public.crm_meta_leads as meta_lead
    where meta_lead.lead_id_meta = p_lead_id_meta;

    if v_lead_id is not null then
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
    end if;

    return query select v_lead_id, false;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_id_empresa::text || ':' || p_telefone));

  select lead.id
    into v_lead_id
  from public.crm_leads as lead
  where lead.id_empresa = p_id_empresa
    and lead.telefone = p_telefone
  order by lead.created_at asc nulls last, lead.id asc
  limit 1
  for update;

  if v_lead_id is not null then
    update public.crm_meta_leads
    set crm_lead_id = v_lead_id
    where id = v_meta_row_id;

    update public.crm_leads
    set
      email = case
        when coalesce(trim(email), '') = '' and coalesce(trim(p_email), '') <> '' then p_email
        else email
      end,
      updated_at = now()
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
      jsonb_build_object(
        'source', 'meta_webhook',
        'meta_lead_id', p_lead_id_meta,
        'form_id', p_form_id,
        'duplicate_phone', true,
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
    return;
  end if;

  insert into public.crm_leads (
    id_empresa,
    nome,
    telefone,
    email,
    id_empreendimento,
    crm_stage_id,
    crm_assigned_to,
    origem,
    observacoes
  ) values (
    p_id_empresa,
    p_nome,
    p_telefone,
    p_email,
    p_id_empreendimento,
    p_crm_stage_id,
    p_crm_assigned_to,
    p_origem,
    p_observacoes
  )
  returning id into v_lead_id;

  update public.crm_meta_leads
  set crm_lead_id = v_lead_id
  where id = v_meta_row_id;

  insert into public.crm_lead_activities (
    lead_id,
    crm_user_id,
    tipo,
    descricao,
    metadata
  ) values (
    v_lead_id,
    null,
    'system',
    'Lead recebido via integração Meta',
    jsonb_build_object(
      'source', 'meta_webhook',
      'meta_lead_id', p_lead_id_meta,
      'form_id', p_form_id,
      'duplicate_phone', false
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

  return query select v_lead_id, true;
end;
$$;

revoke all on function public.crm_ingest_meta_lead(
  bigint, text, text, text, text, text, jsonb, text, text, bigint, bigint, uuid
) from public, anon, authenticated;

grant execute on function public.crm_ingest_meta_lead(
  bigint, text, text, text, text, text, jsonb, text, text, bigint, bigint, uuid
) to service_role;

create or replace function public.crm_ingest_site_lead(
  p_source_id uuid,
  p_id_empresa bigint,
  p_id_empreendimento bigint,
  p_nome text,
  p_telefone text,
  p_email text default null,
  p_origem text default 'SI',
  p_observacoes text default null,
  p_raw_data jsonb default '{}'::jsonb,
  p_external_id text default null
)
returns table(lead_id bigint, inserted boolean, event_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead_id bigint;
  v_event_id uuid;
  v_stage_id bigint;
  v_assigned_to uuid;
  v_ai_user_id uuid;
begin
  if p_source_id is null then
    raise exception 'Fonte obrigatória';
  end if;

  if coalesce(trim(p_telefone), '') = '' then
    raise exception 'Telefone obrigatório';
  end if;

  if not exists (
    select 1
    from public.crm_site_lead_sources source
    where source.id = p_source_id
      and source.id_empresa = p_id_empresa
      and source.id_empreendimento = p_id_empreendimento
      and source.active = true
  ) then
    raise exception 'Fonte de lead inválida ou inativa';
  end if;

  if not exists (
    select 1
    from public.empreendimento emp
    where emp.id = p_id_empreendimento
      and emp.id_empresa = p_id_empresa
  ) then
    raise exception 'Empreendimento inválido para a empresa';
  end if;

  if p_external_id is not null then
    select event.crm_lead_id, event.id
      into v_lead_id, v_event_id
    from public.crm_site_lead_events event
    where event.source_id = p_source_id
      and event.external_id = p_external_id
    order by event.received_at asc
    limit 1;

    if v_event_id is not null then
      if v_lead_id is not null then
        perform public.crm_record_lead_attribution(
          p_crm_lead_id => v_lead_id,
          p_id_empresa => p_id_empresa,
          p_source_type => 'site',
          p_source_id => p_source_id,
          p_utm_source => public.crm_extract_attribution_value(p_raw_data, array['utm_source', 'utmSource']),
          p_utm_medium => public.crm_extract_attribution_value(p_raw_data, array['utm_medium', 'utmMedium']),
          p_utm_campaign => public.crm_extract_attribution_value(p_raw_data, array['utm_campaign', 'utmCampaign']),
          p_utm_content => public.crm_extract_attribution_value(p_raw_data, array['utm_content', 'utmContent']),
          p_utm_term => public.crm_extract_attribution_value(p_raw_data, array['utm_term', 'utmTerm']),
          p_utm_id => public.crm_extract_attribution_value(p_raw_data, array['utm_id', 'utmId']),
          p_utm_adgroup => public.crm_extract_attribution_value(p_raw_data, array['utm_adgroup', 'utm_adset', 'adgroup', 'adset']),
          p_utm_ad => public.crm_extract_attribution_value(p_raw_data, array['utm_ad', 'ad', 'ad_name']),
          p_gclid => public.crm_extract_attribution_value(p_raw_data, array['gclid']),
          p_gbraid => public.crm_extract_attribution_value(p_raw_data, array['gbraid']),
          p_wbraid => public.crm_extract_attribution_value(p_raw_data, array['wbraid']),
          p_fbclid => public.crm_extract_attribution_value(p_raw_data, array['fbclid']),
          p_landing_page_url => coalesce(public.crm_extract_attribution_value(p_raw_data, array['landing_page_url', 'page_url', 'url']), p_raw_data ->> 'request_origin'),
          p_referrer_url => coalesce(public.crm_extract_attribution_value(p_raw_data, array['referrer_url', 'referrer', 'referer']), p_raw_data ->> 'request_referer'),
          p_user_agent => p_raw_data ->> 'request_user_agent',
          p_raw_data => coalesce(p_raw_data, '{}'::jsonb)
        );
      end if;
      return query select v_lead_id, false, v_event_id;
      return;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_id_empresa::text || ':' || p_telefone));

  select lead.id
    into v_lead_id
  from public.crm_leads lead
  where lead.id_empresa = p_id_empresa
    and (
      lead.telefone = p_telefone
      or (
        coalesce(trim(p_email), '') <> ''
        and coalesce(trim(lead.email), '') <> ''
        and lower(trim(lead.email)) = lower(trim(p_email))
      )
    )
  order by lead.created_at asc nulls last, lead.id asc
  limit 1
  for update;

  select public.crm_get_or_create_ai_user(p_id_empresa) into v_ai_user_id;

  if v_lead_id is not null then
    update public.crm_leads
    set
      email = case
        when coalesce(trim(email), '') = '' and coalesce(trim(p_email), '') <> '' then p_email
        else email
      end,
      id_empreendimento = case
        when id_empreendimento is null then p_id_empreendimento
        else id_empreendimento
      end,
      updated_at = now()
    where id = v_lead_id;

    insert into public.crm_site_lead_events (
      source_id,
      id_empresa,
      id_empreendimento,
      crm_lead_id,
      external_id,
      status,
      raw_data
    ) values (
      p_source_id,
      p_id_empresa,
      p_id_empreendimento,
      v_lead_id,
      p_external_id,
      'duplicate',
      coalesce(p_raw_data, '{}'::jsonb)
    )
    returning id into v_event_id;

    insert into public.crm_lead_activities (
      lead_id,
      crm_user_id,
      tipo,
      descricao,
      metadata
    ) values (
      v_lead_id,
      v_ai_user_id,
      'site_form_resubmission',
      'Novo cadastro recebido via formulário do site.',
      jsonb_build_object(
        'source', 'site_form',
        'source_id', p_source_id,
        'event_id', v_event_id,
        'duplicate', true,
        'id_empreendimento', p_id_empreendimento
      )
    );

    perform public.crm_record_lead_attribution(
      p_crm_lead_id => v_lead_id,
      p_id_empresa => p_id_empresa,
      p_source_type => 'site',
      p_source_id => p_source_id,
      p_utm_source => public.crm_extract_attribution_value(p_raw_data, array['utm_source', 'utmSource']),
      p_utm_medium => public.crm_extract_attribution_value(p_raw_data, array['utm_medium', 'utmMedium']),
      p_utm_campaign => public.crm_extract_attribution_value(p_raw_data, array['utm_campaign', 'utmCampaign']),
      p_utm_content => public.crm_extract_attribution_value(p_raw_data, array['utm_content', 'utmContent']),
      p_utm_term => public.crm_extract_attribution_value(p_raw_data, array['utm_term', 'utmTerm']),
      p_utm_id => public.crm_extract_attribution_value(p_raw_data, array['utm_id', 'utmId']),
      p_utm_adgroup => public.crm_extract_attribution_value(p_raw_data, array['utm_adgroup', 'utm_adset', 'adgroup', 'adset']),
      p_utm_ad => public.crm_extract_attribution_value(p_raw_data, array['utm_ad', 'ad', 'ad_name']),
      p_gclid => public.crm_extract_attribution_value(p_raw_data, array['gclid']),
      p_gbraid => public.crm_extract_attribution_value(p_raw_data, array['gbraid']),
      p_wbraid => public.crm_extract_attribution_value(p_raw_data, array['wbraid']),
      p_fbclid => public.crm_extract_attribution_value(p_raw_data, array['fbclid']),
      p_landing_page_url => coalesce(public.crm_extract_attribution_value(p_raw_data, array['landing_page_url', 'page_url', 'url']), p_raw_data ->> 'request_origin'),
      p_referrer_url => coalesce(public.crm_extract_attribution_value(p_raw_data, array['referrer_url', 'referrer', 'referer']), p_raw_data ->> 'request_referer'),
      p_user_agent => p_raw_data ->> 'request_user_agent',
      p_raw_data => coalesce(p_raw_data, '{}'::jsonb)
    );

    update public.crm_site_lead_sources
    set
      leads_count = leads_count + 1,
      last_lead_at = now(),
      last_error = null
    where id = p_source_id;

    return query select v_lead_id, false, v_event_id;
    return;
  end if;

  perform public.crm_sync_company_global_config(p_id_empresa);

  select stage.id
    into v_stage_id
  from public.crm_stages stage
  where stage.id_empresa = p_id_empresa
    and coalesce(stage.ativo, true) = true
  order by stage.ordem asc nulls last, stage.id asc
  limit 1;

  select user_row.id
    into v_assigned_to
  from public.crm_users user_row
  where user_row.id_empresa = p_id_empresa
    and coalesce(user_row.active, true) = true
    and user_row.role in ('manager', 'gestor')
  order by user_row.created_at asc nulls last
  limit 1;

  if v_assigned_to is null then
    select user_row.id
      into v_assigned_to
    from public.crm_users user_row
    where user_row.id_empresa = p_id_empresa
      and coalesce(user_row.active, true) = true
      and user_row.role = 'agent'
    order by user_row.created_at asc nulls last
    limit 1;
  end if;

  insert into public.crm_leads (
    id_empresa,
    nome,
    telefone,
    email,
    id_empreendimento,
    crm_stage_id,
    crm_assigned_to,
    origem,
    observacoes,
    status
  ) values (
    p_id_empresa,
    coalesce(nullif(trim(p_nome), ''), 'Lead sem nome'),
    p_telefone,
    nullif(trim(p_email), ''),
    p_id_empreendimento,
    v_stage_id,
    v_assigned_to,
    coalesce(nullif(trim(p_origem), ''), 'SI'),
    p_observacoes,
    'ativo'
  )
  returning id into v_lead_id;

  insert into public.crm_site_lead_events (
    source_id,
    id_empresa,
    id_empreendimento,
    crm_lead_id,
    external_id,
    status,
    raw_data
  ) values (
    p_source_id,
    p_id_empresa,
    p_id_empreendimento,
    v_lead_id,
    p_external_id,
    'created',
    coalesce(p_raw_data, '{}'::jsonb)
  )
  returning id into v_event_id;

  insert into public.crm_lead_activities (
    lead_id,
    crm_user_id,
    tipo,
    descricao,
    metadata
  ) values (
    v_lead_id,
    v_ai_user_id,
    'site_form',
    'Lead recebido via formulário do site.',
    jsonb_build_object(
      'source', 'site_form',
      'source_id', p_source_id,
      'event_id', v_event_id,
      'duplicate', false,
      'id_empreendimento', p_id_empreendimento
    )
  );

  perform public.crm_record_lead_attribution(
    p_crm_lead_id => v_lead_id,
    p_id_empresa => p_id_empresa,
    p_source_type => 'site',
    p_source_id => p_source_id,
    p_utm_source => public.crm_extract_attribution_value(p_raw_data, array['utm_source', 'utmSource']),
    p_utm_medium => public.crm_extract_attribution_value(p_raw_data, array['utm_medium', 'utmMedium']),
    p_utm_campaign => public.crm_extract_attribution_value(p_raw_data, array['utm_campaign', 'utmCampaign']),
    p_utm_content => public.crm_extract_attribution_value(p_raw_data, array['utm_content', 'utmContent']),
    p_utm_term => public.crm_extract_attribution_value(p_raw_data, array['utm_term', 'utmTerm']),
    p_utm_id => public.crm_extract_attribution_value(p_raw_data, array['utm_id', 'utmId']),
    p_utm_adgroup => public.crm_extract_attribution_value(p_raw_data, array['utm_adgroup', 'utm_adset', 'adgroup', 'adset']),
    p_utm_ad => public.crm_extract_attribution_value(p_raw_data, array['utm_ad', 'ad', 'ad_name']),
    p_gclid => public.crm_extract_attribution_value(p_raw_data, array['gclid']),
    p_gbraid => public.crm_extract_attribution_value(p_raw_data, array['gbraid']),
    p_wbraid => public.crm_extract_attribution_value(p_raw_data, array['wbraid']),
    p_fbclid => public.crm_extract_attribution_value(p_raw_data, array['fbclid']),
    p_landing_page_url => coalesce(public.crm_extract_attribution_value(p_raw_data, array['landing_page_url', 'page_url', 'url']), p_raw_data ->> 'request_origin'),
    p_referrer_url => coalesce(public.crm_extract_attribution_value(p_raw_data, array['referrer_url', 'referrer', 'referer']), p_raw_data ->> 'request_referer'),
    p_user_agent => p_raw_data ->> 'request_user_agent',
    p_raw_data => coalesce(p_raw_data, '{}'::jsonb)
  );

  update public.crm_site_lead_sources
  set
    leads_count = leads_count + 1,
    last_lead_at = now(),
    last_error = null
  where id = p_source_id;

  return query select v_lead_id, true, v_event_id;
end;
$$;

revoke all on function public.crm_ingest_site_lead(
  uuid, bigint, bigint, text, text, text, text, text, jsonb, text
) from public, anon, authenticated;

grant execute on function public.crm_ingest_site_lead(
  uuid, bigint, bigint, text, text, text, text, text, jsonb, text
) to service_role;
