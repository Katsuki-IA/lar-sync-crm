import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { formatLeadOrigin } from "./lead-origin";
import { getAttributionSource } from "./attribution-source";

export type LeadReportAttribution = {
  origem: string;
  fonte: string;
  campanha: string;
  conjunto: string;
  anuncio: string;
};

export const LEAD_REPORT_ATTRIBUTION_COLUMNS = [
  { key: "origem", label: "Origem" },
  { key: "fonte", label: "Fonte" },
  { key: "campanha", label: "Campanha" },
  { key: "conjunto", label: "Conjunto de anúncios" },
  { key: "anuncio", label: "Anúncio" },
] as const;

type Attribution = Pick<Database["public"]["Tables"]["crm_lead_attribution"]["Row"],
  "crm_lead_id" | "source_type" | "meta_form_id" | "meta_campaign_name" | "meta_adset_name" |
  "meta_ad_name" | "utm_source" | "utm_campaign" | "utm_adgroup" | "utm_ad" | "utm_content" | "raw_data"
>;

function text(value: string | null | undefined) {
  return value?.trim() || null;
}

function captureType(raw: Json) {
  return raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.capture_type === "string"
    ? raw.capture_type : null;
}

export function reportAttribution(origin?: string | null, attribution?: Attribution): LeadReportAttribution {
  const sourceType = text(attribution?.source_type);
  const source = getAttributionSource(attribution ? {
    capture_type: captureType(attribution.raw_data),
    meta_form_id: text(attribution.meta_form_id),
    utm_source: text(attribution.utm_source),
    source_type: sourceType,
  } : null, sourceType === "meta" ? "Meta Ads" : origin ?? "");
  return {
    origem: text(origin) ? formatLeadOrigin(origin) : "—",
    fonte: source === "Não identificada" ? "—" : source,
    campanha: text(attribution?.meta_campaign_name) || text(attribution?.utm_campaign) || "—",
    conjunto: text(attribution?.meta_adset_name) || text(attribution?.utm_adgroup) || "—",
    anuncio: text(attribution?.meta_ad_name) || text(attribution?.utm_ad) || text(attribution?.utm_content) || "—",
  };
}

export function reportCrmLeadId(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Both reads are tenant-scoped and paginated; no query is issued per lead.
export async function loadLeadReportAttribution(
  client: SupabaseClient<Database>, companyId: number, linkedIds: Array<string | null>,
) {
  const ids = [...new Set(linkedIds.flatMap(value => {
    const id = reportCrmLeadId(value);
    return id == null ? [] : [id];
  }))];
  const result = new Map<number, LeadReportAttribution>();
  for (let index = 0; index < ids.length; index += 50) {
    const group = ids.slice(index, index + 50);
    const origins = new Map<number, string | null>();
    for (let offset = 0; ; offset += 1000) {
      const page = await client.from("crm_leads").select("id,origem")
        .eq("id_empresa", companyId).in("id", group)
        .order("id", { ascending: true }).range(offset, offset + 999);
      if (page.error) throw page.error;
      for (const lead of page.data ?? []) origins.set(lead.id, lead.origem);
      if (!page.data || page.data.length < 1000) break;
    }
    const latest = new Map<number, Attribution>();
    for (let offset = 0; ; offset += 1000) {
      const page = await client.from("crm_lead_attribution")
        .select("crm_lead_id,source_type,meta_form_id,meta_campaign_name,meta_adset_name,meta_ad_name,utm_source,utm_campaign,utm_adgroup,utm_ad,utm_content,raw_data")
        .eq("id_empresa", companyId).in("crm_lead_id", group)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }).range(offset, offset + 999);
      if (page.error) throw page.error;
      for (const row of page.data ?? []) {
        if (origins.has(row.crm_lead_id) && !latest.has(row.crm_lead_id)) latest.set(row.crm_lead_id, row);
      }
      if (!page.data || page.data.length < 1000) break;
    }
    for (const [id, origin] of origins) result.set(id, reportAttribution(origin, latest.get(id)));
  }
  return result;
}