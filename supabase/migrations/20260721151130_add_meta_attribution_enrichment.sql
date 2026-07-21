alter table public.crm_lead_attribution
  add column if not exists meta_ad_name text,
  add column if not exists meta_adset_name text,
  add column if not exists meta_campaign_name text,
  add column if not exists meta_account_id text,
  add column if not exists meta_enriched_at timestamptz,
  add column if not exists meta_enrichment_error text;

create index if not exists idx_crm_lead_attribution_meta_ad
  on public.crm_lead_attribution (id_empresa, meta_ad_id)
  where meta_ad_id is not null;

comment on column public.crm_lead_attribution.meta_ad_name is
  'Nome do anuncio retornado pela Meta Marketing API.';
comment on column public.crm_lead_attribution.meta_adset_name is
  'Nome do conjunto de anuncios retornado pela Meta Marketing API.';
comment on column public.crm_lead_attribution.meta_campaign_name is
  'Nome da campanha retornada pela Meta Marketing API.';
comment on column public.crm_lead_attribution.meta_enrichment_error is
  'Ultimo erro ao tentar enriquecer a atribuicao Meta com dados de anuncio.';
