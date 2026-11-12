begin;
insert into public.ai_cost_sources(workflow_id,name) values ('ai-cost-test','Transactional test');
insert into public.ai_cost_execution_queue(execution_id,workflow_id,started_at) values ('ai-cost-test','ai-cost-test',now());
select public.ai_cost_record_execution('{"execution_id":"ai-cost-test","workflow_id":"ai-cost-test","events":[{"event_key":"ai-cost-test:1","node_id":"test","node_name":"test","run_index":0,"occurred_at":"2026-11-12T12:00:00Z","provider":"openai","model":"gpt-4.1","model_source":"configuration","operation":"text","input_tokens":1000,"cached_tokens":null,"output_tokens":100,"usage_status":"cache_unknown","attribution_status":"missing"}]}');
select public.ai_cost_record_execution('{"execution_id":"ai-cost-test","workflow_id":"ai-cost-test","events":[{"event_key":"ai-cost-test:1","node_id":"test","node_name":"test","run_index":0,"occurred_at":"2026-11-12T12:00:00Z","provider":"openai","model":"gpt-4.1","model_source":"configuration","operation":"text","input_tokens":1000,"cached_tokens":null,"output_tokens":100,"usage_status":"cache_unknown","attribution_status":"missing"}]}');
do $$ begin
 if (select count(*) from public.ai_usage_events where execution_id='ai-cost-test')<>1 then raise exception 'duplicate event'; end if;
 if not (select cost_min_usd=.0013 and cost_max_usd=.0028 from public.ai_usage_priced where execution_id='ai-cost-test') then raise exception 'incorrect cache cost range'; end if;
 if has_table_privilege('anon','public.ai_usage_events','select') or has_table_privilege('authenticated','public.ai_usage_events','select') or has_function_privilege('anon','public.ai_cost_monthly_report(date)','execute') then raise exception 'unauthorized access'; end if;
 if (select status from public.ai_cost_execution_queue where execution_id='ai-cost-test')<>'done' then raise exception 'queue not completed'; end if;
 begin
   perform public.ai_cost_record_execution('{"execution_id":"ai-cost-test","workflow_id":"ai-cost-test"}');
   raise exception 'missing payload accepted';
 exception when others then
   if sqlerrm<>'invalid events' then raise; end if;
 end;
end $$;
rollback;
select 'passed: idempotence, pricing, permissions, atomic completion, invalid input; rolled back' as result;
