-- NULL preserves existing connections on the original RD_CLIENT_* app.
-- Store only the public client ID; client secrets remain in Edge Function secrets.
ALTER TABLE public.crm_rd_connections ADD COLUMN oauth_client_id text;
COMMENT ON COLUMN public.crm_rd_connections.oauth_client_id IS
  'OAuth app that issued the tokens. NULL uses the original RD_CLIENT_* configuration.';
