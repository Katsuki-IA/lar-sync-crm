import fs from 'node:fs';
const initial=fs.readFileSync('supabase/migrations/20261112114225_ai_cost_ledger.sql','utf8');
const record=initial.slice(initial.indexOf('create function public.ai_cost_record_execution'),initial.indexOf('-- Verified on'));
const functions=record.replace(/create function/g,'create or replace function').replace('create view public.ai_usage_priced','create or replace view public.ai_usage_priced')
 .replace("if jsonb_typeof(p_payload->'events') <> 'array'", "if coalesce(jsonb_typeof(p_payload->'events'),'null') <> 'array'")
 .replace('on conflict(event_key) do nothing;',`on conflict(event_key) do update set input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,usage_status=excluded.usage_status where ai_usage_events.usage_status='missing' and excluded.usage_status='estimated';`)
 .replace("count(*) filter(where e.input_tokens is not null and e.output_tokens is not null) measured_calls,", "count(*) filter(where e.usage_status in ('complete','cache_unknown')) measured_calls,\n count(*) filter(where e.usage_status='estimated') estimated_calls,");
fs.writeFileSync('supabase/migrations/20261112115051_ai_cost_estimates_and_rates.sql',`-- Preserve n8n estimates as estimates, never provider measurements.\nalter table public.ai_usage_events drop constraint ai_usage_events_usage_status_check;\nalter table public.ai_usage_events add constraint ai_usage_events_usage_status_check check(usage_status in ('complete','cache_unknown','missing','invalid','estimated'));\n${functions}`);
