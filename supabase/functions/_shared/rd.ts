import { createSupabaseAdmin } from "./meta.ts";
import { resolveLeadOrigin } from "./lead-origin.ts";

const DEFAULT_APP_ORIGIN = "https://lar-sync-crm.lovable.app";

type RdConnectionToken = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
};

type RdTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  errors?: { error_message?: string };
  error?: string;
  error_description?: string;
};

type RdOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  supabaseUrl: string;
  appOrigin: string;
};

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): string {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

export function getRdConfig() {
  const clientId = Deno.env.get("RD_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("RD_CLIENT_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const appOrigin = Deno.env.get("APP_ORIGIN") ?? DEFAULT_APP_ORIGIN;
  const redirectUri =
    Deno.env.get("RD_REDIRECT_URI") ??
    `${appOrigin}/integracoes/rd`;

  if (!clientId || !clientSecret) {
    throw new Error("RD_CLIENT_ID ou RD_CLIENT_SECRET não configurado no Supabase");
  }
  if (!redirectUri || !supabaseUrl) {
    throw new Error("RD_REDIRECT_URI ou SUPABASE_URL não configurado");
  }

  return { clientId, clientSecret, redirectUri, supabaseUrl, appOrigin };
}

export function getRdDestinationConfig() {
  const config = getRdConfig();
  const clientId = Deno.env.get("RD_CRM_CLIENT_ID") ?? config.clientId;
  const clientSecret = Deno.env.get("RD_CRM_CLIENT_SECRET") ?? config.clientSecret;
  const redirectUri =
    Deno.env.get("RD_CRM_REDIRECT_URI") ??
    `${config.appOrigin}/integracoes/rd`;
  if (!clientId || !clientSecret) {
    throw new Error("RD_CRM_CLIENT_ID ou RD_CRM_CLIENT_SECRET não configurado no Supabase");
  }
  return { ...config, clientId, clientSecret, redirectUri };
}

export async function createRdSignedState(args: {
  userId: string;
  idEmpresa: number;
  empreendimentoId: number;
  funnelId: number;
  secret: string;
}) {
  const payload = base64UrlEncode(
    JSON.stringify({
      userId: args.userId,
      idEmpresa: args.idEmpresa,
      empreendimentoId: args.empreendimentoId,
      funnelId: args.funnelId,
      expiresAt: Date.now() + 10 * 60 * 1000,
      nonce: crypto.randomUUID(),
    }),
  );
  return `${payload}.${await signPayload(payload, args.secret)}`;
}

export async function createRdDestinationSignedState(args: {
  userId: string;
  idEmpresa: number;
  secret: string;
}) {
  const payload = base64UrlEncode(
    JSON.stringify({
      userId: args.userId,
      idEmpresa: args.idEmpresa,
      purpose: "external_crm_destination",
      expiresAt: Date.now() + 10 * 60 * 1000,
      nonce: crypto.randomUUID(),
    }),
  );
  return `${payload}.${await signPayload(payload, args.secret)}`;
}

export async function verifyRdSignedState(args: {
  state: string;
  expectedUserId: string;
  expectedEmpresa: number;
  secret: string;
}) {
  const [payload, signature] = args.state.split(".");
  if (!payload || !signature) throw new Error("State OAuth inválido");
  if ((await signPayload(payload, args.secret)) !== signature) {
    throw new Error("State OAuth inválido");
  }

  const parsed = JSON.parse(base64UrlDecode(payload)) as {
    userId?: string;
    idEmpresa?: number;
    empreendimentoId?: number;
    funnelId?: number;
    expiresAt?: number;
  };
  if (
    parsed.userId !== args.expectedUserId ||
    parsed.idEmpresa !== args.expectedEmpresa ||
    !parsed.empreendimentoId ||
    !parsed.funnelId ||
    !parsed.expiresAt ||
    parsed.expiresAt < Date.now()
  ) {
    throw new Error("State OAuth expirado ou incompatível");
  }
  return { empreendimentoId: parsed.empreendimentoId, funnelId: parsed.funnelId };
}

export async function verifyRdDestinationSignedState(args: {
  state: string;
  expectedUserId: string;
  expectedEmpresa: number;
  secret: string;
}) {
  const [payload, signature] = args.state.split(".");
  if (!payload || !signature) throw new Error("State OAuth inválido");
  if ((await signPayload(payload, args.secret)) !== signature) {
    throw new Error("State OAuth inválido");
  }

  const parsed = JSON.parse(base64UrlDecode(payload)) as {
    userId?: string;
    idEmpresa?: number;
    purpose?: string;
    expiresAt?: number;
  };
  if (
    parsed.userId !== args.expectedUserId ||
    parsed.idEmpresa !== args.expectedEmpresa ||
    parsed.purpose !== "external_crm_destination" ||
    !parsed.expiresAt ||
    parsed.expiresAt < Date.now()
  ) {
    throw new Error("State OAuth expirado ou incompatível");
  }
}

export function buildRdOAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const url = new URL("https://api.rd.services/auth/dialog");
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("state", args.state);
  return url.toString();
}

export function buildRdCrmOAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state?: string;
}) {
  const url = new URL("https://accounts.rdstation.com/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  if (args.state) url.searchParams.set("state", args.state);
  return url.toString();
}

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

function rdError(payload: Record<string, unknown>, fallback: string) {
  const errors = payload.errors as { error_message?: string } | undefined;
  return (
    errors?.error_message ??
    (typeof payload.error_description === "string" ? payload.error_description : null) ??
    (typeof payload.error === "string" ? payload.error : null) ??
    fallback
  );
}

export async function exchangeRdAuthorizationCode(code: string, config: RdOAuthConfig = getRdConfig()) {
  const { clientId, clientSecret } = config;
  const response = await fetch("https://api.rd.services/auth/token?token_by=code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const payload = (await readJson(response)) as RdTokenResponse;
  if (!response.ok || !payload.access_token || !payload.refresh_token) {
    throw new Error(rdError(payload as Record<string, unknown>, "Falha ao obter token do RD Station"));
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenExpiresAt: tokenExpiresAt(payload.expires_in),
  };
}

export async function exchangeRdCrmAuthorizationCode(code: string, config: RdOAuthConfig) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  const response = await fetch("https://api.rd.services/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await readJson(response)) as RdTokenResponse;
  if (!response.ok || !payload.access_token || !payload.refresh_token) {
    throw new Error(rdError(payload as Record<string, unknown>, "Falha ao obter token do RD Station CRM"));
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenExpiresAt: tokenExpiresAt(payload.expires_in),
  };
}

export async function refreshRdAccessToken(connection: RdConnectionToken) {
  if (!connection.refresh_token) throw new Error("Refresh token do RD Station ausente");
  const { clientId, clientSecret } = getRdConfig();
  const response = await fetch("https://api.rd.services/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refresh_token,
    }),
  });
  const payload = (await readJson(response)) as RdTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(rdError(payload as Record<string, unknown>, "Falha ao renovar token do RD Station"));
  }

  const next = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? connection.refresh_token,
    token_expires_at: tokenExpiresAt(payload.expires_in),
  };
  const supabaseAdmin = createSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("crm_rd_connections")
    .update(next)
    .eq("id", connection.id);
  if (error) throw new Error(error.message);
  return { accessToken: next.access_token, refreshToken: next.refresh_token };
}

export async function getValidRdAccessToken(connection: RdConnectionToken) {
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : 0;
  if (connection.access_token && expiresAt > Date.now() + 60_000) {
    return connection.access_token;
  }
  return (await refreshRdAccessToken(connection)).accessToken;
}

export async function createRdWebhook(accessToken: string, callbackUrl: string) {
  const response = await fetch("https://api.rd.services/integrations/webhooks", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: "WEBHOOK.CONVERTED",
      entity_type: "CONTACT",
      url: callbackUrl,
      http_method: "POST",
      include_relations: ["COMPANY", "CONTACT_FUNNEL"],
    }),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(rdError(payload, "Falha ao criar webhook no RD Station"));
  }
  const item = Array.isArray(payload) ? payload[0] : payload;
  const webhook = item as { uuid?: string; platform_account_id?: string | number };
  if (!webhook.uuid) throw new Error("RD Station não retornou o identificador do webhook");
  return {
    webhookUuid: webhook.uuid,
    platformAccountId:
      webhook.platform_account_id === undefined ? null : String(webhook.platform_account_id),
  };
}

export async function deleteRdWebhook(accessToken: string, webhookUuid: string) {
  const response = await fetch(
    `https://api.rd.services/integrations/webhooks/${encodeURIComponent(webhookUuid)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 204 || response.status === 404) return;
  const payload = await readJson(response);
  if (!response.ok) throw new Error(rdError(payload, "Falha ao remover webhook do RD Station"));
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function resolveRdOrigin(value: unknown) {
  if (typeof value !== "string") return "ND";
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const keywordMap: Array<[RegExp, string]> = [
    [/google/, "GO"],
    [/facebook|meta/, "FB"],
    [/instagram/, "IG"],
    [/whats\s*app/, "WA"],
    [/linkedin/, "LK"],
    [/twitter|\bx\b/, "TW"],
    [/pinterest/, "PR"],
    [/tik\s*tok/, "TT"],
    [/email/, "EM"],
    [/refer/, "RF"],
    [/diret/, "TD"],
    [/busca paga|paid|cpc|display/, "MP"],
    [/organica|organic/, "BO"],
  ];
  for (const [pattern, code] of keywordMap) {
    if (pattern.test(normalized)) return code;
  }
  return resolveLeadOrigin(value);
}
