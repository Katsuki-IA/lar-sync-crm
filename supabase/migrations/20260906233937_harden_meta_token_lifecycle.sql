alter table public.crm_meta_connections
  add column if not exists token_expires_at timestamptz,
  add column if not exists token_data_access_expires_at timestamptz,
  add column if not exists token_last_validated_at timestamptz,
  add column if not exists token_validation_error text;

comment on column public.crm_meta_connections.token_expires_at is
  'Validade informada pela Meta para o token de longa duração.';

comment on column public.crm_meta_connections.token_data_access_expires_at is
  'Limite de acesso a dados informado pelo debug_token da Meta, quando disponível.';

create table if not exists public.crm_meta_connection_events (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null,
  connection_id uuid not null references public.crm_meta_connections(id) on delete cascade,
  event_type text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.crm_meta_connection_events enable row level security;

create index if not exists crm_meta_connection_events_company_created_idx
  on public.crm_meta_connection_events (id_empresa, created_at desc);

create index if not exists crm_meta_connection_events_connection_created_idx
  on public.crm_meta_connection_events (connection_id, created_at desc);

do $migration$
declare
  existing_job_id bigint;
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'meta_health_cron_secret'
  ) then
    raise exception 'Vault secret meta_health_cron_secret must exist before this migration runs';
  end if;

  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'meta_watchdog_anon_key'
  ) then
    raise exception 'Vault secret meta_watchdog_anon_key must exist before this migration runs';
  end if;

  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'meta-connection-watchdog'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'meta-connection-watchdog',
    '*/15 * * * *',
    $cron$
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
        body := jsonb_build_object('scheduled_at', now()),
        timeout_milliseconds := 55000
      );
    $cron$
  );
end
$migration$;
