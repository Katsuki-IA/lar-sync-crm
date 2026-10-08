-- Expose only the channel discriminator, never the raw webhook or click identity.
drop function public.crm_get_lead_attribution(bigint);
create function public.crm_get_lead_attribution(p_lead_id bigint)
returns table(source_type text, meta_form_id text, meta_page_id text,
  meta_campaign_name text, meta_adset_name text, meta_ad_name text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text,
  utm_term text, gclid text, landing_page_url text, referrer_url text,
  created_at timestamptz, meta_enriched_at timestamptz, meta_platform text,
  capture_type text)
language sql stable security definer set search_path = '' as $$
select a.source_type,a.meta_form_id,a.meta_page_id,a.meta_campaign_name,
  a.meta_adset_name,a.meta_ad_name,a.utm_source,a.utm_medium,a.utm_campaign,
  a.utm_content,a.utm_term,a.gclid,a.landing_page_url,a.referrer_url,
  a.created_at,a.meta_enriched_at,nullif(btrim(a.raw_data #>> '{lead,platform}'),''),
  case when a.raw_data->>'capture_type'='ctwa'
    or (a.raw_data #>> '{referral,source_type}'='ad' and nullif(a.raw_data #>> '{referral,source_id}','') is not null)
    then 'ctwa' else null end
from public.crm_lead_attribution a
join public.crm_leads l on l.id=a.crm_lead_id and l.id_empresa=a.id_empresa
where l.id=p_lead_id and public.crm_can_access_lead(p_lead_id)
order by a.updated_at desc nulls last,a.created_at desc nulls last limit 1;
$$;
revoke all on function public.crm_get_lead_attribution(bigint) from public,anon;
grant execute on function public.crm_get_lead_attribution(bigint) to authenticated;
