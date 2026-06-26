import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import { getRdDestinationConfig } from "../_shared/rd.ts";

type ExternalRdConnection = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
};

type RdStage = {
  id: string;
  name: string;
};

type RdFunnel = {
  id: string;
  name: string;
  stages: RdStage[];
};

const CANDIDATE_ENDPOINTS = [
  "https://api.rd.services/crm/v2/pipelines",
  "https://api.rd.services/platform/funnels",
  "https://api.rd.services/platform/contact_funnels",
  "https://api.rd.services/platform/contacts/funnels",
  "https://api.rd.services/platform/funnel_stages",
  "https://api.rd.services/platform/contact_funnel_stages",
];

function tokenExpiresAt(expiresIn?: number) {
  const seconds = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 86_400;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text };
  }
}

function readError(payload: Record<string, unknown>, fallback: string) {
  const errors = payload.errors as { error_message?: string } | undefined;
  return (
    errors?.error_message ??
    (typeof payload.error_description === "string" ? payload.error_description : null) ??
    (typeof payload.error === "string" ? payload.error : null) ??
    fallback
  );
}

function endpointError(endpoint: string, response: Response, payload: Record<string, unknown>) {
  return `${endpoint}: ${response.status} ${readError(payload, response.statusText)}`;
}

async function getValidExternalRdAccessToken(connection: ExternalRdConnection) {
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : 0;
  if (connection.access_token && expiresAt > Date.now() + 60_000) return connection.access_token;
  if (!connection.refresh_token) throw new Error("Refresh token do RD Station ausente");

  const { clientId, clientSecret } = getRdDestinationConfig();
  const response = await fetch("https://api.rd.services/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refresh_token,
    }),
  });
  const payload = await readJson(response);
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(readError(payload, "Falha ao renovar token do RD Station"));
  }

  const next = {
    access_token: payload.access_token,
    refresh_token:
      typeof payload.refresh_token === "string" ? payload.refresh_token : connection.refresh_token,
    token_expires_at: tokenExpiresAt(
      typeof payload.expires_in === "number" ? payload.expires_in : undefined,
    ),
  };

  const supabaseAdmin = createSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("crm_external_crm_connections")
    .update(next)
    .eq("id", connection.id);
  if (error) throw new Error(error.message);

  return next.access_token;
}

function stringValue(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function itemArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
}

function firstItemArray(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const items = itemArray(item[key]);
    if (items.length) return items;
  }
  return [];
}

function extractCollection(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return itemArray(payload);
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  for (const key of [
    "pipelines",
    "pipeline_stages",
    "funnels",
    "contact_funnels",
    "funnel_stages",
    "stages",
    "items",
    "data",
  ]) {
    const items = itemArray(obj[key]);
    if (items.length) return items;
  }
  return [];
}

function normalizeStages(items: Record<string, unknown>[]) {
  return items
    .map((stage) => {
      const id = stringValue(stage, ["id", "_id", "uuid", "stage_id", "identifier", "value"]);
      const name = stringValue(stage, ["name", "label", "title", "value"]);
      return id && name ? { id, name } : null;
    })
    .filter((stage): stage is RdStage => Boolean(stage));
}

function normalizeFunnels(payload: unknown): RdFunnel[] {
  const items = extractCollection(payload);
  const funnels = items
    .map((item) => {
      const id = stringValue(item, ["id", "_id", "uuid", "pipeline_id", "identifier", "value"]);
      const name = stringValue(item, ["name", "label", "title", "value"]);
      const stageItems = firstItemArray(item, [
        "stages",
        "pipeline_stages",
        "deal_stages",
        "funnel_stages",
        "contact_funnel_stages",
      ]);
      const stages = normalizeStages(stageItems);
      return id && name ? { id, name, stages } : null;
    })
    .filter((funnel): funnel is RdFunnel => Boolean(funnel));

  if (funnels.length) return funnels;

  const stages = normalizeStages(items);
  return stages.length
    ? [{ id: "default", name: "Funil padrão", stages }]
    : [];
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();
    const { data: connection, error } = await supabaseAdmin
      .from("crm_external_crm_connections")
      .select("id,access_token,refresh_token,token_expires_at")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("provider", "rd_station")
      .eq("active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!connection) throw new Error("RD Station CRM não conectado");

    const accessToken = await getValidExternalRdAccessToken(connection);
    const errors: string[] = [];

    for (const endpoint of CANDIDATE_ENDPOINTS) {
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await readJson(response);
      if (!response.ok) {
        errors.push(endpointError(endpoint, response, payload));
        continue;
      }
      const funnels = normalizeFunnels(payload);
      if (funnels.length) {
        return jsonResponse({ funnels, warning: null });
      }
    }

    return jsonResponse({
      funnels: [],
      warning:
        errors.some((error) => error.includes("global_credentials"))
          ? "A conexão atual do RD não possui credenciais globais para acessar os funis do RD CRM. Use um aplicativo RD CRM com acesso a credenciais globais ou configure RD_CRM_CLIENT_ID e RD_CRM_CLIENT_SECRET no Supabase."
          : "A RD Station não retornou a lista de funis/etapas para os escopos atuais deste aplicativo.",
      details: errors.slice(0, 3),
    });
  });
});
