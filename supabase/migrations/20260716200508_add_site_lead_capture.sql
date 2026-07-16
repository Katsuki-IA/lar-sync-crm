create table if not exists public.crm_site_lead_sources (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  id_empreendimento bigint not null references public.empreendimento(id) on delete cascade,
  nome text not null,
  token text not null unique,
  allowed_domains text[] not null default '{}',
  origem text not null default 'SI',
  field_mapping jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  leads_count integer not null default 0,
  last_lead_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_site_lead_sources_empresa
on public.crm_site_lead_sources (id_empresa);

create index if not exists idx_crm_site_lead_sources_empreendimento
on public.crm_site_lead_sources (id_empreendimento);

create index if not exists idx_crm_site_lead_sources_active
on public.crm_site_lead_sources (active);

drop trigger if exists set_updated_at_crm_site_lead_sources on public.crm_site_lead_sources;
create trigger set_updated_at_crm_site_lead_sources
before update on public.crm_site_lead_sources
for each row execute function public.handle_updated_at();

alter table public.crm_site_lead_sources enable row level security;
revoke all on public.crm_site_lead_sources from public, anon, authenticated;
grant all on public.crm_site_lead_sources to service_role;

create table if not exists public.crm_site_lead_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.crm_site_lead_sources(id) on delete set null,
  id_empresa bigint not null references public.empresa_dados(id) on delete cascade,
  id_empreendimento bigint references public.empreendimento(id) on delete set null,
  crm_lead_id bigint references public.crm_leads(id) on delete set null,
  external_id text,
  status text not null default 'received',
  error text,
  raw_data jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create unique index if not exists idx_crm_site_lead_events_external
on public.crm_site_lead_events (source_id, external_id)
where external_id is not null;

create index if not exists idx_crm_site_lead_events_empresa_received
on public.crm_site_lead_events (id_empresa, received_at desc);

create index if not exists idx_crm_site_lead_events_crm_lead
on public.crm_site_lead_events (crm_lead_id);

alter table public.crm_site_lead_events enable row level security;
revoke all on public.crm_site_lead_events from public, anon, authenticated;
grant all on public.crm_site_lead_events to service_role;

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

  insert into public.fila_leads (
    id_lead,
    crm_provider,
    id_empresa,
    id_empreendimento,
    verificado,
    status
  ) values (
    v_lead_id::text,
    'Hub',
    p_id_empresa,
    p_id_empreendimento,
    0,
    'pending'
  )
  on conflict do nothing;

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
