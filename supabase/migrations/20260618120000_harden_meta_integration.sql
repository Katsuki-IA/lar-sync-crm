ALTER TABLE public.crm_meta_forms
ADD COLUMN IF NOT EXISTS page_access_token text;

REVOKE ALL ON TABLE public.crm_meta_connections FROM anon, authenticated;
REVOKE ALL ON TABLE public.crm_meta_forms FROM anon, authenticated;
REVOKE ALL ON TABLE public.crm_meta_field_mapping FROM anon, authenticated;
REVOKE ALL ON TABLE public.crm_meta_leads FROM anon, authenticated;

COMMENT ON COLUMN public.crm_meta_connections.user_access_token IS
  'Sensitive Meta user token. Read and write only through trusted server functions.';

COMMENT ON COLUMN public.crm_meta_forms.page_access_token IS
  'Sensitive Meta page token used by trusted server functions to retrieve lead data.';
