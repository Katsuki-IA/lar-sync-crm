create or replace view public.crm_meta_connections_monitor
with (security_invoker = true)
as
select
  id,
  id_empresa,
  connected_at,
  active,
  health_status,
  last_health_check_at,
  last_error,
  token_expires_at,
  token_data_access_expires_at,
  token_last_validated_at,
  token_validation_error
from public.crm_meta_connections;

comment on view public.crm_meta_connections_monitor is
  'Leitura segura para monitoramento externo, sem tokens de acesso da Meta.';

revoke all on table public.crm_meta_connections_monitor from public, anon, authenticated;
grant select on table public.crm_meta_connections_monitor to service_role;

do $migration$
declare
  watchdog_job_id bigint;
  daily_recovery_job_id bigint;
begin
  select jobid
    into watchdog_job_id
  from cron.job
  where jobname = 'meta-connection-watchdog'
  limit 1;

  if watchdog_job_id is null then
    raise exception 'Cron job meta-connection-watchdog not found';
  end if;

  perform cron.alter_job(
    job_id := watchdog_job_id,
    schedule := '0 */2 * * *',
    command := $health$
      select net.http_post(
        url := 'https://tswdxgefmhjvjwafaxjl.supabase.co/functions/v1/meta-connection-watchdog',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'meta_watchdog_anon_key'
          ),
          'x-meta-health-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'meta_health_cron_secret'
          )
        ),
        body := jsonb_build_object('scheduled_at', now(), 'mode', 'health'),
        timeout_milliseconds := 55000
      );
    $health$
  );

  select jobid
    into daily_recovery_job_id
  from cron.job
  where jobname = 'meta-leads-daily-recovery'
  limit 1;

  if daily_recovery_job_id is not null then
    perform cron.unschedule(daily_recovery_job_id);
  end if;

  -- pg_cron usa UTC. 15:00 UTC corresponde a 12:00 em America/Sao_Paulo.
  perform cron.schedule(
    'meta-leads-daily-recovery',
    '0 15 * * *',
    $daily$
      select net.http_post(
        url := 'https://tswdxgefmhjvjwafaxjl.supabase.co/functions/v1/meta-connection-watchdog',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'meta_watchdog_anon_key'
          ),
          'x-meta-health-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'meta_health_cron_secret'
          )
        ),
        body := jsonb_build_object('scheduled_at', now(), 'mode', 'daily_recovery'),
        timeout_milliseconds := 55000
      );
    $daily$
  );
end
$migration$;
