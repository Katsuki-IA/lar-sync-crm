import type { createSupabaseAdmin } from "./meta.ts";

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;

type GraphError = {
  error?: {
    message?: string;
  };
};

type DebugTokenResponse = GraphError & {
  data?: {
    scopes?: string[];
  };
};

type PermissionResponse = GraphError & {
  data?: Array<{
    permission?: string;
    status?: string;
  }>;
};

type MetaObjectRef = {
  id?: string;
  name?: string;
};

type MetaAdResponse = GraphError & {
  id?: string;
  name?: string;
  account_id?: string;
  adset_id?: string;
  campaign_id?: string;
  adset?: MetaObjectRef & {
    campaign?: MetaObjectRef;
    campaign_id?: string;
  };
  campaign?: MetaObjectRef;
};

type MetaAdsetResponse = GraphError & {
  id?: string;
  name?: string;
  campaign_id?: string;
  campaign?: MetaObjectRef;
};

type MetaCampaignResponse = GraphError & {
  id?: string;
  name?: string;
};

type AttributionRow = {
  id: string;
  crm_lead_id: number | null;
  id_empresa: number;
  meta_leadgen_id: string | null;
  meta_ad_id: string | null;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
};

export type MetaTokenPermissionCheck = {
  hasAdsRead: boolean;
  scopes: string[];
  error: string | null;
};

export type MetaAttributionEnrichmentResult = {
  checked: number;
  enriched: number;
  failed: Array<{ attributionId: string; message: string }>;
};

async function fetchGraphJson<T extends GraphError>(url: URL): Promise<T> {
  const response = await fetch(url.toString());
  const json = (await response.json()) as T;
  if (!response.ok || json.error) {
    throw new Error(json.error?.message ?? "Falha ao consultar a Graph API");
  }
  return json;
}

export async function checkMetaTokenPermissions(args: {
  appId: string;
  appSecret: string;
  graphVersion: string;
  userAccessToken: string;
}): Promise<MetaTokenPermissionCheck> {
  const scopes = new Set<string>();

  if (args.appId && args.appSecret) {
    try {
      const debugUrl = new URL(`https://graph.facebook.com/${args.graphVersion}/debug_token`);
      debugUrl.searchParams.set("input_token", args.userAccessToken);
      debugUrl.searchParams.set("access_token", `${args.appId}|${args.appSecret}`);
      const debug = await fetchGraphJson<DebugTokenResponse>(debugUrl);
      for (const scope of debug.data?.scopes ?? []) scopes.add(scope);
      return {
        hasAdsRead: scopes.has("ads_read"),
        scopes: Array.from(scopes).sort(),
        error: null,
      };
    } catch (error) {
      console.warn("Falha ao checar permissoes Meta via debug_token", error);
    }
  }

  try {
    const permissionsUrl = new URL(`https://graph.facebook.com/${args.graphVersion}/me/permissions`);
    permissionsUrl.searchParams.set("access_token", args.userAccessToken);
    const permissions = await fetchGraphJson<PermissionResponse>(permissionsUrl);
    for (const permission of permissions.data ?? []) {
      if (permission.status === "granted" && permission.permission) {
        scopes.add(permission.permission);
      }
    }
    return {
      hasAdsRead: scopes.has("ads_read"),
      scopes: Array.from(scopes).sort(),
      error: null,
    };
  } catch (error) {
    return {
      hasAdsRead: false,
      scopes: Array.from(scopes).sort(),
      error: error instanceof Error ? error.message : "Falha ao checar permissoes Meta",
    };
  }
}

async function fetchAdDetails(args: {
  accessToken: string;
  graphVersion: string;
  adId: string;
}) {
  const adUrl = new URL(`https://graph.facebook.com/${args.graphVersion}/${args.adId}`);
  adUrl.searchParams.set(
    "fields",
    "id,name,account_id,adset_id,campaign_id,adset{id,name,campaign_id,campaign{id,name}},campaign{id,name}",
  );
  adUrl.searchParams.set("access_token", args.accessToken);

  const ad = await fetchGraphJson<MetaAdResponse>(adUrl);
  let adsetId = ad.adset?.id ?? ad.adset_id ?? null;
  let adsetName = ad.adset?.name ?? null;
  let campaignId = ad.campaign?.id ?? ad.adset?.campaign?.id ?? ad.campaign_id ?? ad.adset?.campaign_id ?? null;
  let campaignName = ad.campaign?.name ?? ad.adset?.campaign?.name ?? null;

  if (adsetId && (!adsetName || !campaignId || !campaignName)) {
    const adsetUrl = new URL(`https://graph.facebook.com/${args.graphVersion}/${adsetId}`);
    adsetUrl.searchParams.set("fields", "id,name,campaign_id,campaign{id,name}");
    adsetUrl.searchParams.set("access_token", args.accessToken);
    try {
      const adset = await fetchGraphJson<MetaAdsetResponse>(adsetUrl);
      adsetName = adsetName ?? adset.name ?? null;
      campaignId = campaignId ?? adset.campaign?.id ?? adset.campaign_id ?? null;
      campaignName = campaignName ?? adset.campaign?.name ?? null;
    } catch (error) {
      console.warn(`Falha ao buscar conjunto Meta ${adsetId}`, error);
    }
  }

  if (campaignId && !campaignName) {
    const campaignUrl = new URL(`https://graph.facebook.com/${args.graphVersion}/${campaignId}`);
    campaignUrl.searchParams.set("fields", "id,name");
    campaignUrl.searchParams.set("access_token", args.accessToken);
    try {
      const campaign = await fetchGraphJson<MetaCampaignResponse>(campaignUrl);
      campaignName = campaign.name ?? null;
    } catch (error) {
      console.warn(`Falha ao buscar campanha Meta ${campaignId}`, error);
    }
  }

  return {
    meta_ad_name: ad.name ?? null,
    meta_adset_id: adsetId,
    meta_adset_name: adsetName,
    meta_campaign_id: campaignId,
    meta_campaign_name: campaignName,
    meta_account_id: ad.account_id ?? null,
  };
}

export async function enrichMetaAttributionForCompany(args: {
  supabaseAdmin: SupabaseAdmin;
  idEmpresa: number;
  accessToken: string;
  graphVersion: string;
  leadId?: number | null;
  metaLeadgenId?: string | null;
  limit?: number;
}): Promise<MetaAttributionEnrichmentResult> {
  const limit = Math.max(1, Math.min(args.limit ?? 10, 100));
  let query = args.supabaseAdmin
    .from("crm_lead_attribution")
    .select("id,crm_lead_id,id_empresa,meta_leadgen_id,meta_ad_id,meta_adset_id,meta_campaign_id")
    .eq("id_empresa", args.idEmpresa)
    .not("meta_ad_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (args.leadId) query = query.eq("crm_lead_id", args.leadId);
  if (args.metaLeadgenId) query = query.eq("meta_leadgen_id", args.metaLeadgenId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as AttributionRow[];
  const failed: Array<{ attributionId: string; message: string }> = [];
  let enriched = 0;

  for (const row of rows) {
    if (!row.meta_ad_id) continue;
    try {
      const details = await fetchAdDetails({
        accessToken: args.accessToken,
        graphVersion: args.graphVersion,
        adId: row.meta_ad_id,
      });
      const { error: updateError } = await args.supabaseAdmin
        .from("crm_lead_attribution")
        .update({
          ...details,
          meta_enriched_at: new Date().toISOString(),
          meta_enrichment_error: null,
        })
        .eq("id", row.id);
      if (updateError) throw new Error(updateError.message);
      enriched += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao enriquecer atribuicao";
      failed.push({ attributionId: row.id, message });
      await args.supabaseAdmin
        .from("crm_lead_attribution")
        .update({
          meta_enriched_at: new Date().toISOString(),
          meta_enrichment_error: message,
        })
        .eq("id", row.id);
    }
  }

  return {
    checked: rows.length,
    enriched,
    failed,
  };
}
