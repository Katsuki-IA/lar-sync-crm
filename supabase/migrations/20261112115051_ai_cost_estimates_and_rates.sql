-- Preserve n8n estimates as estimates, never provider measurements.
alter table public.ai_usage_events drop constraint ai_usage_events_usage_status_check;
alter table public.ai_usage_events add constraint ai_usage_events_usage_status_check check(usage_status in ('complete','cache_unknown','missing','invalid','estimated'));
create or replace function public.ai_cost_record_execution(p_payload jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if coalesce(jsonb_typeof(p_payload->'events'),'null') <> 'array' or jsonb_array_length(p_payload->'events')>10000 then
    raise exception 'invalid events';
  end if;
  if not exists(select 1 from public.ai_cost_execution_queue where execution_id=p_payload->>'execution_id' and workflow_id=p_payload->>'workflow_id') then raise exception 'execution not queued'; end if;
  insert into public.ai_usage_events(event_key,execution_id,workflow_id,node_id,node_name,run_index,id_empresa,occurred_at,provider,model,model_source,operation,input_tokens,cached_tokens,output_tokens,usage_status,attribution_status,request_id)
  select x.event_key,p_payload->>'execution_id',p_payload->>'workflow_id',x.node_id,x.node_name,x.run_index,e.id,x.occurred_at,x.provider,x.model,x.model_source,x.operation,x.input_tokens,x.cached_tokens,x.output_tokens,x.usage_status,
    case when x.id_empresa is not null and e.id is null then 'unknown_company' else x.attribution_status end,x.request_id
  from jsonb_to_recordset(p_payload->'events') as x(event_key text,node_id text,node_name text,run_index integer,id_empresa bigint,occurred_at timestamptz,provider text,model text,model_source text,operation text,input_tokens bigint,cached_tokens bigint,output_tokens bigint,usage_status text,attribution_status text,request_id text)
  left join public.empresa_dados e on e.id=x.id_empresa
  on conflict(event_key) do update set input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,usage_status=excluded.usage_status where ai_usage_events.usage_status='missing' and excluded.usage_status='estimated';
  get diagnostics n = row_count;
  update public.ai_cost_execution_queue set status='done',collected_at=now(),lease_until=null,last_error=null where execution_id=p_payload->>'execution_id';
  return n;
end $$;
revoke all on function public.ai_cost_record_execution(jsonb) from public,anon,authenticated;
grant execute on function public.ai_cost_record_execution(jsonb) to service_role;

create or replace view public.ai_usage_priced with (security_invoker=true) as
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

create or replace function public.ai_cost_monthly_report(p_month date) returns jsonb
language sql stable security invoker set search_path = '' as $$
with bounds as(select date_trunc('month',p_month::timestamp) at time zone 'America/Sao_Paulo' a,(date_trunc('month',p_month::timestamp)+interval '1 month') at time zone 'America/Sao_Paulo' b),
rows as(select e.id_empresa,coalesce(c.nome,'Não atribuída') company,e.provider,e.environment,count(*) calls,
 count(*) filter(where e.usage_status in ('complete','cache_unknown')) measured_calls,
 count(*) filter(where e.usage_status='estimated') estimated_calls,
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

