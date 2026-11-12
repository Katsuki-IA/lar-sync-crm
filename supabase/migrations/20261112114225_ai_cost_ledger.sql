-- Costs are private platform data. Clients read only via the authenticated admin report.
create table public.ai_cost_sources (
  workflow_id text primary key, name text not null, enabled boolean not null default true,
  environment text not null default 'production' check (environment in ('production','test')),
  last_scan_at timestamptz
);
create table public.ai_cost_execution_queue (
  execution_id text primary key, workflow_id text not null references public.ai_cost_sources(workflow_id),
  started_at timestamptz not null, status text not null default 'pending' check(status in ('pending','processing','done','unavailable')),
  lease_until timestamptz, attempts integer not null default 0, last_error text,
  collected_at timestamptz, created_at timestamptz not null default now()
);
create index ai_cost_queue_pending on public.ai_cost_execution_queue(status,lease_until,started_at);
create index ai_cost_queue_workflow on public.ai_cost_execution_queue(workflow_id);
create table public.ai_usage_events (
  event_key text primary key, execution_id text not null references public.ai_cost_execution_queue(execution_id),
  workflow_id text not null references public.ai_cost_sources(workflow_id),
  node_id text not null, node_name text not null, run_index integer not null check(run_index>=0),
  id_empresa bigint references public.empresa_dados(id), occurred_at timestamptz not null,
  provider text not null check(provider in ('openai','deepseek')), model text,
  model_source text not null check(model_source in ('response','configuration','unknown')),
  operation text not null check(operation in ('text','audio')),
  input_tokens bigint check(input_tokens>=0), cached_tokens bigint check(cached_tokens>=0), output_tokens bigint check(output_tokens>=0),
  usage_status text not null check(usage_status in ('complete','cache_unknown','missing','invalid')),
  attribution_status text not null check(attribution_status in ('explicit','ambiguous','missing','unknown_company')),
  request_id text, collected_at timestamptz not null default now(),
  check(cached_tokens is null or (input_tokens is not null and cached_tokens<=input_tokens))
);
create index ai_usage_company_month on public.ai_usage_events(id_empresa,occurred_at);
create index ai_usage_month on public.ai_usage_events(occurred_at);
create index ai_usage_execution on public.ai_usage_events(execution_id);
create index ai_usage_workflow on public.ai_usage_events(workflow_id);
create table public.ai_cost_rates (
  provider text not null check(provider in ('openai','deepseek')), model text not null,
  valid_from timestamptz not null, valid_to timestamptz,
  input_usd_per_million numeric(18,9) not null check(input_usd_per_million>=0),
  cached_usd_per_million numeric(18,9) not null check(cached_usd_per_million>=0),
  output_usd_per_million numeric(18,9) not null check(output_usd_per_million>=0),
  source_url text not null, notes text not null default '',
  primary key(provider,model,valid_from), check(valid_to is null or valid_to>valid_from),
  check(cached_usd_per_million<=input_usd_per_million)
);
create table public.ai_provider_cost_periods (
  provider text not null check(provider in ('openai','deepseek')), period_start timestamptz not null,
  period_end timestamptz not null, scope text not null, amount_usd numeric(24,12) not null check(amount_usd>=0),
  source_file text not null, imported_at timestamptz not null default now(),
  primary key(provider,period_start,period_end,scope), check(period_end>period_start)
);
alter table public.ai_cost_sources enable row level security;
alter table public.ai_cost_execution_queue enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.ai_cost_rates enable row level security;
alter table public.ai_provider_cost_periods enable row level security;
revoke all on public.ai_cost_sources,public.ai_cost_execution_queue,public.ai_usage_events,public.ai_cost_rates,public.ai_provider_cost_periods from public,anon,authenticated;
grant select,insert,update,delete on public.ai_cost_sources,public.ai_cost_execution_queue,public.ai_usage_events,public.ai_cost_rates,public.ai_provider_cost_periods to service_role;

-- Single transaction: either all sanitized events and completion are saved, or the lease is retried.
create function public.ai_cost_record_execution(p_payload jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if jsonb_typeof(p_payload->'events') <> 'array' or jsonb_array_length(p_payload->'events')>10000 then
    raise exception 'invalid events';
  end if;
  if not exists(select 1 from public.ai_cost_execution_queue where execution_id=p_payload->>'execution_id' and workflow_id=p_payload->>'workflow_id') then raise exception 'execution not queued'; end if;
  insert into public.ai_usage_events(event_key,execution_id,workflow_id,node_id,node_name,run_index,id_empresa,occurred_at,provider,model,model_source,operation,input_tokens,cached_tokens,output_tokens,usage_status,attribution_status,request_id)
  select x.event_key,p_payload->>'execution_id',p_payload->>'workflow_id',x.node_id,x.node_name,x.run_index,e.id,x.occurred_at,x.provider,x.model,x.model_source,x.operation,x.input_tokens,x.cached_tokens,x.output_tokens,x.usage_status,
    case when x.id_empresa is not null and e.id is null then 'unknown_company' else x.attribution_status end,x.request_id
  from jsonb_to_recordset(p_payload->'events') as x(event_key text,node_id text,node_name text,run_index integer,id_empresa bigint,occurred_at timestamptz,provider text,model text,model_source text,operation text,input_tokens bigint,cached_tokens bigint,output_tokens bigint,usage_status text,attribution_status text,request_id text)
  left join public.empresa_dados e on e.id=x.id_empresa
  on conflict(event_key) do nothing;
  get diagnostics n = row_count;
  update public.ai_cost_execution_queue set status='done',collected_at=now(),lease_until=null,last_error=null where execution_id=p_payload->>'execution_id';
  return n;
end $$;
revoke all on function public.ai_cost_record_execution(jsonb) from public,anon,authenticated;
grant execute on function public.ai_cost_record_execution(jsonb) to service_role;

create view public.ai_usage_priced with (security_invoker=true) as
select e.*,s.environment,
  case when e.operation='text' and e.input_tokens is not null and e.output_tokens is not null then
    ((e.input_tokens-coalesce(e.cached_tokens,e.input_tokens))*r.input_usd_per_million + coalesce(e.cached_tokens,e.input_tokens)*r.cached_usd_per_million + e.output_tokens*r.output_usd_per_million)/1000000 end as cost_min_usd,
  case when e.operation='text' and e.input_tokens is not null and e.output_tokens is not null then
    ((e.input_tokens-coalesce(e.cached_tokens,0))*r.input_usd_per_million + coalesce(e.cached_tokens,0)*r.cached_usd_per_million + e.output_tokens*r.output_usd_per_million)/1000000 end as cost_max_usd,
  r.source_url as rate_source
from public.ai_usage_events e join public.ai_cost_sources s using(workflow_id)
left join lateral (
 select r.* from public.ai_cost_rates r where r.provider=e.provider and r.model=e.model and e.occurred_at>=r.valid_from and (r.valid_to is null or e.occurred_at<r.valid_to) order by r.valid_from desc limit 1
) r on true;
revoke all on public.ai_usage_priced from public,anon,authenticated;
grant select on public.ai_usage_priced to service_role;

create function public.ai_cost_monthly_report(p_month date) returns jsonb
language sql stable security invoker set search_path = '' as $$
with bounds as(select date_trunc('month',p_month::timestamp) at time zone 'America/Sao_Paulo' a,(date_trunc('month',p_month::timestamp)+interval '1 month') at time zone 'America/Sao_Paulo' b),
rows as(select e.id_empresa,coalesce(c.nome,'Não atribuída') company,e.provider,e.environment,count(*) calls,
 count(*) filter(where e.input_tokens is not null and e.output_tokens is not null) measured_calls,
 count(*) filter(where e.cost_max_usd is not null) priced_calls,
 count(*) filter(where e.cached_tokens is null) cache_unknown_calls,
 sum(e.input_tokens) input_tokens,sum(e.output_tokens) output_tokens,sum(e.cached_tokens) cached_tokens,
 sum(e.cost_min_usd) cost_min_usd,sum(e.cost_max_usd) cost_max_usd
 from public.ai_usage_priced e cross join bounds b left join public.empresa_dados c on c.id=e.id_empresa
 where e.occurred_at>=b.a and e.occurred_at<b.b group by e.id_empresa,c.nome,e.provider,e.environment)
select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.company,r.provider) from rows r),'[]'::jsonb),
 'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from public.ai_cost_sources s),'[]'::jsonb),
 'queue',(select jsonb_build_object('pending',count(*) filter(where status in ('pending','processing')),'unavailable',count(*) filter(where status='unavailable'),'last_collected_at',max(collected_at)) from public.ai_cost_execution_queue),
 'provider_costs',coalesce((select jsonb_agg(to_jsonb(p)) from public.ai_provider_cost_periods p cross join bounds b where p.period_start<b.b and p.period_end>b.a),'[]'::jsonb),
 'rates',coalesce((select jsonb_agg(to_jsonb(r)) from public.ai_cost_rates r),'[]'::jsonb));
$$;
revoke all on function public.ai_cost_monthly_report(date) from public,anon,authenticated;
grant execute on function public.ai_cost_monthly_report(date) to service_role;

-- Verified on 2026-11-12; deliberately not applied retrospectively to October.
insert into public.ai_cost_rates(provider,model,valid_from,input_usd_per_million,cached_usd_per_million,output_usd_per_million,source_url,notes) values
('openai','gpt-4.1','2026-11-12T00:00:00Z',2,.5,8,'https://developers.openai.com/api/docs/models/gpt-4.1','Standard; exclui ferramentas e modalidades cobradas separadamente'),
('openai','gpt-4.1-mini','2026-11-12T00:00:00Z',.4,.1,1.6,'https://developers.openai.com/api/docs/models/gpt-4.1-mini','Standard'),
('openai','gpt-4o-mini','2026-11-12T00:00:00Z',.15,.075,.6,'https://developers.openai.com/api/docs/models/gpt-4o-mini','Standard'),
('openai','gpt-5-mini','2026-11-12T00:00:00Z',.25,.025,2,'https://developers.openai.com/api/docs/models/gpt-5-mini','Standard');
comment on table public.ai_usage_events is 'Observed provider node outputs, not guaranteed physical request count. Missing cache/SDK retries/audio usage must remain explicit. No message text or credentials.';
