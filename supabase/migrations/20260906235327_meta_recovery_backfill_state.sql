alter table public.crm_meta_connections
  add column if not exists recovery_backfill_completed_at timestamptz;

comment on column public.crm_meta_connections.recovery_backfill_completed_at is
  'Momento em que a recuperação automática de 72 horas foi concluída após a última reconexão Meta.';
