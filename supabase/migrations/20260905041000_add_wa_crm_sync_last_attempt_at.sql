alter table public.wa_crm_sync_queue
  add column if not exists last_attempt_at timestamptz;
