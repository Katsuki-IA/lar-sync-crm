export type CvAttribution = {
  source_type?: string | null;
  meta_ad_id?: string | null;
  meta_ad_name?: string | null;
  meta_adset_id?: string | null;
  meta_adset_name?: string | null;
  meta_campaign_id?: string | null;
  meta_campaign_name?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  raw_data?: { lead?: { platform?: string | null }; capture_type?: string | null } | null;
};

// Only deployed columns; platform is supplied by Meta in raw_data.lead.platform.
export const CV_ATTRIBUTION_SELECT =
  "source_type,meta_ad_id,meta_ad_name,meta_adset_id,meta_adset_name,meta_campaign_id,meta_campaign_name,utm_source,utm_medium,utm_campaign,utm_content,utm_term,gclid,gbraid,wbraid,raw_data";

const CV_ORIGINS = new Set(
  "AP AT BC BO CH CB DP EM FB GO IT IG LI LK MP OP CL CO GE IM PV PT PO RF SC TD TW SI UK ND VO RM PR TT CV WA OU AV".split(" "),
);

function sourceOrigin(value?: string | null): string | null {
  const source = String(value ?? "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    fb: "FB", facebook: "FB", "facebook ads": "FB", "facebook_ads": "FB",
    ig: "IG", instagram: "IG", "instagram ads": "IG", "instagram_ads": "IG",
    google: "GO", "google ads": "GO", google_ads: "GO", adwords: "GO",
    meta: "MP", "meta ads": "MP", meta_ads: "MP",
    whatsapp: "WA", wa: "WA", site: "SI", website: "SI",
    linkedin: "LK", tiktok: "TT",
  };
  return aliases[source] ?? (CV_ORIGINS.has(source.toUpperCase()) ? source.toUpperCase() : null);
}

export function resolveCvOrigin(attribution: CvAttribution | null, leadOrigin?: string | null): string {
  const platform = sourceOrigin(attribution?.raw_data?.lead?.platform);
  if (platform === "FB" || platform === "IG") return platform;
  const utmOrigin = sourceOrigin(attribution?.utm_source);
  if (utmOrigin) return utmOrigin;
  if (attribution?.gclid || attribution?.gbraid || attribution?.wbraid) return "GO";
  if (attribution?.meta_ad_id || attribution?.meta_campaign_id || attribution?.meta_ad_name || attribution?.meta_campaign_name) {
    return "MP";
  }
  return sourceOrigin(attribution?.source_type) ?? sourceOrigin(leadOrigin) ?? "WA";
}

export function resolveCvMedia(attribution: CvAttribution | null, leadOrigin?: string | null): string | null {
  const origin = resolveCvOrigin(attribution, leadOrigin);
  if (origin === "MP") {
    const isMeta = [attribution?.utm_source, attribution?.source_type, leadOrigin].some(value =>
      ["meta", "meta ads", "meta_ads"].includes(String(value ?? "").trim().toLowerCase()),
    ) || Boolean(attribution?.meta_ad_id || attribution?.meta_campaign_id || attribution?.meta_ad_name || attribution?.meta_campaign_name);
    return isMeta ? "meta_ads" : "midia_paga";
  }
  // WA is also the origin fallback. Do not manufacture media from that fallback.
  if (origin === "WA" && ![attribution?.utm_source, attribution?.source_type, leadOrigin].some(value => sourceOrigin(value) === "WA")) return null;
  const media: Record<string, string> = {
    FB: "facebook_ads", IG: "instagram_ads", GO: "google_ads", SI: "site",
    WA: "whatsapp", LK: "linkedin", TT: "tiktok",
  };
  return media[origin] ?? null;
}

export function cvAttributionNote(attribution: CvAttribution | null): string | null {
  if (!attribution) return null;
  const fields: Array<[string, string | null | undefined]> = [
    ["Fonte", attribution.source_type],
    ["Plataforma Meta", attribution.raw_data?.lead?.platform],
    ["Tipo de captura", attribution.raw_data?.capture_type],
    ["Campanha", attribution.meta_campaign_name], ["ID da campanha", attribution.meta_campaign_id],
    ["Conjunto de anúncios", attribution.meta_adset_name], ["ID do conjunto", attribution.meta_adset_id],
    ["Anúncio", attribution.meta_ad_name], ["ID do anúncio", attribution.meta_ad_id],
    ["UTM source", attribution.utm_source], ["UTM medium", attribution.utm_medium],
    ["UTM campaign", attribution.utm_campaign], ["UTM content", attribution.utm_content],
    ["UTM term", attribution.utm_term],
  ];
  const lines = fields.filter(([, value]) => value?.trim()).map(([label, value]) =>
    `${label}: ${value!.trim().replace(/[\r\n]+/g, " ").slice(0, 1500)}`,
  );
  return lines.length ? `Rastreamento de origem registrado no HUB\n${lines.join("\n")}` : null;
}

