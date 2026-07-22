create or replace function public.crm_get_lead_attribution(p_lead_id bigint)
returns table (
  source_type text,
  meta_form_id text,
  meta_page_id text,
  meta_campaign_name text,
  meta_adset_name text,
  meta_ad_name text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  gclid text,
  landing_page_url text,
  referrer_url text,
  created_at timestamptz,
  meta_enriched_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    attribution.source_type,
    attribution.meta_form_id,
    attribution.meta_page_id,
    attribution.meta_campaign_name,
    attribution.meta_adset_name,
    attribution.meta_ad_name,
    attribution.utm_source,
    attribution.utm_medium,
    attribution.utm_campaign,
    attribution.utm_content,
    attribution.utm_term,
    attribution.gclid,
    attribution.landing_page_url,
    attribution.referrer_url,
    attribution.created_at,
    attribution.meta_enriched_at
  from public.crm_lead_attribution attribution
  join public.crm_leads lead
    on lead.id = attribution.crm_lead_id
   and lead.id_empresa = attribution.id_empresa
  where lead.id = p_lead_id
    and public.crm_can_access_lead(p_lead_id)
  order by attribution.updated_at desc nulls last, attribution.created_at desc nulls last
  limit 1;
$$;

revoke all on function public.crm_get_lead_attribution(bigint) from public, anon;
grant execute on function public.crm_get_lead_attribution(bigint) to authenticated;
