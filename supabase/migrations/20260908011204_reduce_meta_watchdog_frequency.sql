do $migration$
declare
  watchdog_job_id bigint;
begin
  select jobid
    into watchdog_job_id
  from cron.job
  where jobname = 'meta-connection-watchdog'
  limit 1;

  if watchdog_job_id is null then
    raise exception 'Cron job meta-connection-watchdog not found';
  end if;

  -- A validacao e a recuperacao de contingencia sao pesadas para a Graph API.
  -- Duas horas preservam o watchdog sem consumir a cota a cada 15 minutos.
  perform cron.alter_job(
    watchdog_job_id,
    schedule := '0 */2 * * *'
  );
end
$migration$;
