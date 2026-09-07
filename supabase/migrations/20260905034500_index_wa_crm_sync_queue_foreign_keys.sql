-- Índices de apoio para remoção/consulta pelos relacionamentos da fila.

create index if not exists wa_crm_sync_queue_lead_id_idx
  on public.wa_crm_sync_queue (lead_id);

create index if not exists wa_crm_sync_queue_wa_identity_id_idx
  on public.wa_crm_sync_queue (wa_identity_id)
  where wa_identity_id is not null;
