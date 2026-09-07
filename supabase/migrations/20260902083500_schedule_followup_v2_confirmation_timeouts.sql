do $migration$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'followup-v2-confirmation-timeouts'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'followup-v2-confirmation-timeouts',
    '*/5 * * * *',
    'select public.mark_followup_confirmation_timeouts_v2(100);'
  );
end
$migration$;
