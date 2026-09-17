-- Independent machine credentials. Admin UI and HTTP API access via trusted server only.
create table public.crm_reporting_integrations (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) between 2 and 100),
  empresa_ids bigint[] not null check (cardinality(empresa_ids) between 1 and 100),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  request_window timestamptz,
  request_count integer not null default 0
);
alter table public.crm_reporting_integrations enable row level security;
revoke all on public.crm_reporting_integrations from public, anon, authenticated;
grant select, insert, update, delete on public.crm_reporting_integrations to service_role;
create policy reporting_integrations_service_role on public.crm_reporting_integrations
  for all to service_role using (true) with check (true);

-- Atomic credential validation, usage timestamp and fixed-window request limit.
create function public.crm_reporting_authorize(p_hash text)
returns table (integration_id uuid, empresa_ids bigint[], rate_allowed boolean)
language sql security invoker set search_path = '' as $$
  update public.crm_reporting_integrations as i
  set request_window = date_trunc('minute', now()),
      request_count = case when i.request_window = date_trunc('minute', now())
        then least(i.request_count + 1, 1000000) else 1 end,
      last_used_at = case when i.request_window is distinct from date_trunc('minute', now())
        or i.request_count < 60 then now() else i.last_used_at end
  where i.token_hash = p_hash and i.revoked_at is null
    and (i.expires_at is null or i.expires_at > now())
  returning i.id, i.empresa_ids, i.request_count <= 60;
$$;
revoke all on function public.crm_reporting_authorize(text) from public, anon, authenticated;
grant execute on function public.crm_reporting_authorize(text) to service_role;

create index if not exists reporting_lead_crm_idx on public.lead (id_empresa, id_crm);
create index if not exists reporting_chat_numero_idx
  on public.n8n_chat_conversas (numero, id_empresa, created_at desc);
create index if not exists reporting_chat_phone_idx
  on public.n8n_chat_conversas (id_empresa, telefone, created_at desc);

-- No raw payloads or message content leave this function. Restricted to service_role.
create function public.crm_reporting_lead_page(
  p_empresa bigint, p_start timestamptz, p_end timestamptz,
  p_before bigint default null, p_limit integer default 50
) returns jsonb
language sql stable security invoker set search_path = '' as $$
with page as (
  select c.* from public.crm_leads c
  where c.id_empresa = p_empresa and c.created_at >= p_start and c.created_at < p_end
    and (p_before is null or c.id < p_before)
  order by c.id desc limit least(greatest(p_limit, 1), 100) + 1
), enriched as (
 select c.id, jsonb_build_object(
   'crm_lead_id', c.id, 'nome', c.nome, 'telefone', c.telefone,
   'origem', c.origem, 'criado_em', c.created_at, 'atualizado_em', c.updated_at,
   'id_empreendimento', c.id_empreendimento, 'empreendimento', e.nome,
   'status', c.status, 'crm_stage_id', c.crm_stage_id, 'etapa_crm', s.nome,
   'lead_quente', c.lead_quente, 'qualificado', c.qualificado,
   'lead_conversa_id', case when cardinality(l.ids) = 1 then l.ids[1] else null end,
   'lead_conversa_ids', coalesce(to_jsonb(l.ids), '[]'::jsonb),
   'interacoes_registradas', l.interacoes,
   'houve_conversa', case when msg.id is not null or l.interacoes > 0 then true else null end,
   'ultima_mensagem_em', msg.message_at,
   'ultimo_autor', case msg.type when 'human' then 'cliente' when 'ai' then 'ia' else null end,
   'temperatura', coalesce(cl.temperatura, case when c.lead_quente then 'quente' else null end),
   'classificado_em', cl.classified_at,
   'atribuicoes', coalesce(a.items, '[]'::jsonb),
   'cv_lead_ids', coalesce(cv.ids, '[]'::jsonb)
 ) as data
 from page c
 left join public.empreendimento e on e.id = c.id_empreendimento and e.id_empresa = p_empresa
 left join public.crm_stages s on s.id = c.crm_stage_id and s.id_empresa = p_empresa
 left join lateral (
   select array_agg(x.id order by x.id) ids, array_agg(nullif(x.conversation_key, '')) keys,
     array_agg(nullif(regexp_replace(x.numero, '\D', '', 'g'), '')) phones,
     max(x.qtd_interacoes) interacoes
   from public.lead x where x.id_empresa = p_empresa
     and (x.id = c.lead_id or x.id_crm = c.id::text)
 ) l on true
 left join lateral (
   select jsonb_agg(jsonb_build_object(
     'source_type', x.source_type, 'meta_leadgen_id', x.meta_leadgen_id,
     'meta_form_id', x.meta_form_id, 'meta_page_id', x.meta_page_id,
     'meta_ad_id', x.meta_ad_id, 'meta_ad_name', x.meta_ad_name,
     'meta_adset_id', x.meta_adset_id, 'meta_adset_name', x.meta_adset_name,
     'meta_campaign_id', x.meta_campaign_id, 'meta_campaign_name', x.meta_campaign_name,
     'meta_enriched_at', x.meta_enriched_at, 'gclid', x.gclid, 'gbraid', x.gbraid, 'wbraid', x.wbraid,
     'utm_source', x.utm_source, 'utm_medium', x.utm_medium, 'utm_campaign', x.utm_campaign,
     'utm_content', x.utm_content, 'utm_term', x.utm_term, 'created_at', x.created_at
   ) order by x.created_at desc, x.id) items
   from public.crm_lead_attribution x where x.id_empresa = p_empresa and x.crm_lead_id = c.id
 ) a on true
 left join lateral (
   select jsonb_agg(distinct v.cv_id) ids from (
     select coalesce(nullif(x.response_payload#>>'{dispatch,idlead}', ''),
       nullif(x.response_payload#>>'{dispatch,id_lead}', ''),
       nullif(x.response_payload#>>'{dispatch,id}', ''),
       nullif(x.response_payload->>'idlead', ''), nullif(x.response_payload->>'id', '')) cv_id
     from public.crm_external_crm_send_logs x
     where x.id_empresa = p_empresa and x.lead_id = c.id and x.provider = 'cv_crm' and x.status = 'sent'
   ) v where v.cv_id ~ '^[1-9][0-9]*$'
 ) cv on true
 left join lateral (
   select x.id, x.type, coalesce(x.time, x.created_at) message_at
   from public.n8n_chat_conversas x
   where x.id_empresa = p_empresa
     and (
       x.numero = any(array[regexp_replace(c.telefone, '\D', '', 'g'), regexp_replace(c.telefone, '\D', '', 'g') || p_empresa::text]
         || coalesce(l.phones, array[]::text[])
         || array(select ph || p_empresa::text from unnest(l.phones) ph where ph is not null))
       or x.telefone = any(array[regexp_replace(c.telefone, '\D', '', 'g')] || coalesce(l.phones, array[]::text[]))
       or x.conversation_key = any(array[nullif(c.conversation_key, '')] || coalesce(l.keys, array[]::text[]))
     )
     and x.type in ('human', 'ai')
     and length(btrim(coalesce(x.message->>'content', x.message->>'text', x.message#>>'{}', ''))) > 0
     and coalesce(x.message->>'content', x.message->>'text', x.message#>>'{}', '') !~* '^calling\s+.+\s+with\s+input\s*:'
   order by coalesce(x.time, x.created_at) desc, x.id desc limit 1
 ) msg on true
 left join lateral (
   select x.temperatura, x.classified_at from public.crm_conversation_classifications x
   where x.id_empresa = p_empresa and x.lead_id = any(l.ids)
   order by x.classified_at desc limit 1
 ) cl on true
)
select coalesce(jsonb_agg(data order by id desc), '[]'::jsonb) from enriched;
$$;
revoke all on function public.crm_reporting_lead_page(bigint,timestamptz,timestamptz,bigint,integer)
  from public, anon, authenticated;
grant execute on function public.crm_reporting_lead_page(bigint,timestamptz,timestamptz,bigint,integer)
  to service_role;
