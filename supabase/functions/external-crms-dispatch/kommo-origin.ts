// ABCR account-specific mapping, verified against live Kommo field metadata.
export type OriginEvidence = {
  source_type?: string | null; utm_source?: string | null;
  gclid?: string | null; gbraid?: string | null; wbraid?: string | null;
  meta_ad_id?: string | null; meta_campaign_id?: string | null;
  meta_ad_name?: string | null; meta_campaign_name?: string | null;
  raw_data?: { lead?: { platform?: string | null } } | null;
};
const ACCOUNT = "https://comercialabcrempreendimentoscombr.kommo.com";
export const ABCR_ORIGIN_FIELD_ID = 931892;
const channel = (value: unknown): "Meta" | "Google" | null => {
  const v = String(value ?? "").trim().toLowerCase().replace(/[ _-]+/g, " ");
  if (["fb","ig","meta","facebook","instagram","meta ads","facebook ads","instagram ads"].includes(v)) return "Meta";
  if (["go","google","google ads","adwords","google adwords"].includes(v)) return "Google";
  return null;
};
export function resolveOrigin(a: OriginEvidence | null, leadOrigin?: string | null): "Meta" | "Google" | null {
  // Explicit attribution wins over generic transport labels such as WA or SI.
  const utm = channel(a?.utm_source);
  if (utm) return utm;
  if ([a?.gclid,a?.gbraid,a?.wbraid].some(v => String(v ?? "").trim())) return "Google";
  const platform = channel(a?.raw_data?.lead?.platform);
  if (platform) return platform;
  if ([a?.meta_ad_id,a?.meta_campaign_id,a?.meta_ad_name,a?.meta_campaign_name].some(v => String(v ?? "").trim())) return "Meta";
  return channel(a?.source_type) ?? channel(leadOrigin);
}
export function abcrOriginField(companyId: number, accountUrl: string, a: OriginEvidence | null, leadOrigin?: string | null) {
  if (Number(companyId) !== 9 || accountUrl.replace(/\/$/, "") !== ACCOUNT) return null;
  const value = resolveOrigin(a, leadOrigin);
  return value ? { field_id: ABCR_ORIGIN_FIELD_ID, values: [{ value }] } : null;
}
