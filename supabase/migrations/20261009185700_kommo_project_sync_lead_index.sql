-- Cover lead foreign-key lookups and cascade cleanup independently of the tenant key.
create index crm_kommo_project_sync_lead_idx
  on public.crm_kommo_project_sync(lead_id);
