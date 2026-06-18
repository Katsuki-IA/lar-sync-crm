import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DEFAULT_META_APP_ID = "1267473975460487";
const DEFAULT_META_REDIRECT_URI = "https://lar-sync-crm.lovable.app/integracoes";
const DEFAULT_META_GRAPH_VERSION = "v21.0";
const META_SCOPES = [
  "leads_retrieval",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_ads",
].join(",");

type CrmUserAccess = {
  id_empresa: number;
  role: string;
};

type MetaConnectionStatus = {
  id: string;
  user_name: string | null;
  user_id_meta: string;
  connected_at: string | null;
  active: boolean | null;
};

type MetaFormStatus = {
  id: string;
  form_id: string;
  form_name: string | null;
  page_id: string;
  page_name: string | null;
  leads_count: number | null;
  active: boolean | null;
};

type MetaConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphVersion: string;
};

type MetaPage = {
  id: string;
  name?: string;
  access_token?: string;
};

type MetaLeadForm = {
  id: string;
  name?: string;
  leads_count?: number;
};

type GraphCollection<T> = {
  data?: T[];
  paging?: {
    next?: string;
  };
  error?: {
    message?: string;
  };
};

function getMetaConfig(requireSecret = true): MetaConfig {
  const appId = process.env.META_APP_ID ?? process.env.VITE_META_APP_ID ?? DEFAULT_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET ?? "";
  const redirectUri =
    process.env.META_REDIRECT_URI ??
    process.env.VITE_META_REDIRECT_URI ??
    DEFAULT_META_REDIRECT_URI;
  const graphVersion = process.env.META_GRAPH_VERSION ?? DEFAULT_META_GRAPH_VERSION;

  if (requireSecret && !appSecret) {
    throw new Error("META_APP_SECRET não configurado");
  }

  return { appId, appSecret, redirectUri, graphVersion };
}

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
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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

async function createSignedState(
  userId: string,
  idEmpresa: number,
  secret: string,
): Promise<string> {
  const payload = base64UrlEncode(
    JSON.stringify({
      userId,
      idEmpresa,
      expiresAt: Date.now() + 10 * 60 * 1000,
      nonce: crypto.randomUUID(),
    }),
  );
  return `${payload}.${await signPayload(payload, secret)}`;
}

async function verifySignedState(
  state: string,
  expectedUserId: string,
  expectedEmpresa: number,
  secret: string,
): Promise<void> {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) throw new Error("State OAuth inválido");

  const expectedSignature = await signPayload(payload, secret);
  if (signature !== expectedSignature) throw new Error("State OAuth inválido");

  const parsed = JSON.parse(base64UrlDecode(payload)) as {
    userId?: string;
    idEmpresa?: number;
    expiresAt?: number;
  };

  if (
    parsed.userId !== expectedUserId ||
    parsed.idEmpresa !== expectedEmpresa ||
    !parsed.expiresAt ||
    parsed.expiresAt < Date.now()
  ) {
    throw new Error("State OAuth expirado ou incompatível");
  }
}

async function getAuthorizedCrmUser(userId: string): Promise<CrmUserAccess> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("crm_users")
    .select("id_empresa,role")
    .eq("auth_user_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id_empresa) throw new Error("Usuário sem empresa vinculada");
  if (data.role !== "manager" && data.role !== "super_admin") {
    throw new Error("Apenas gestores podem configurar integrações");
  }

  return { id_empresa: data.id_empresa, role: data.role };
}

async function fetchGraphCollection<T>(initialUrl: URL | string): Promise<T[]> {
  const items: T[] = [];
  let nextUrl: string | null = initialUrl.toString();
  let pageCount = 0;

  while (nextUrl && pageCount < 20) {
    pageCount += 1;
    const response = await fetch(nextUrl);
    const json = (await response.json()) as GraphCollection<T>;

    if (!response.ok || json.error) {
      throw new Error(json.error?.message ?? "Falha ao consultar a Graph API");
    }

    items.push(...(json.data ?? []));
    nextUrl = json.paging?.next ?? null;
  }

  return items;
}

async function syncMetaFormsForConnection(args: {
  idEmpresa: number;
  connectionId: string;
  userAccessToken: string;
  graphVersion: string;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const pagesUrl = new URL(`https://graph.facebook.com/${args.graphVersion}/me/accounts`);
  pagesUrl.searchParams.set("fields", "id,name,access_token");
  pagesUrl.searchParams.set("limit", "100");
  pagesUrl.searchParams.set("access_token", args.userAccessToken);

  const pages = await fetchGraphCollection<MetaPage>(pagesUrl);
  const rows: Array<{
    id_empresa: number;
    connection_id: string;
    page_id: string;
    page_name: string | null;
    page_access_token: string;
    form_id: string;
    form_name: string | null;
    leads_count: number;
    active: boolean;
  }> = [];

  for (const page of pages) {
    if (!page.access_token) continue;

    const formsUrl = new URL(
      `https://graph.facebook.com/${args.graphVersion}/${page.id}/leadgen_forms`,
    );
    formsUrl.searchParams.set("fields", "id,name,leads_count");
    formsUrl.searchParams.set("limit", "100");
    formsUrl.searchParams.set("access_token", page.access_token);

    try {
      const forms = await fetchGraphCollection<MetaLeadForm>(formsUrl);
      rows.push(
        ...forms.map((form) => ({
          id_empresa: args.idEmpresa,
          connection_id: args.connectionId,
          page_id: page.id,
          page_name: page.name ?? null,
          page_access_token: page.access_token!,
          form_id: form.id,
          form_name: form.name ?? null,
          leads_count: form.leads_count ?? 0,
          active: true,
        })),
      );
    } catch (error) {
      console.warn(`Falha ao sincronizar formulários da página Meta ${page.id}`, error);
    }
  }

  const { error: deactivateError } = await supabaseAdmin
    .from("crm_meta_forms")
    .update({ active: false })
    .eq("id_empresa", args.idEmpresa)
    .eq("connection_id", args.connectionId);
  if (deactivateError) throw new Error(deactivateError.message);

  if (rows.length > 0) {
    const { error } = await supabaseAdmin
      .from("crm_meta_forms")
      .upsert(rows, { onConflict: "id_empresa,form_id" });
    if (error) throw new Error(error.message);
  }

  return { pagesCount: pages.length, formsCount: rows.length };
}

export const createMetaOAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { appId, appSecret, redirectUri, graphVersion } = getMetaConfig();
    const crmUser = await getAuthorizedCrmUser(context.userId);
    const state = await createSignedState(context.userId, crmUser.id_empresa, appSecret);

    const url = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`);
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", META_SCOPES);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);

    return { url: url.toString() };
  });

export const exchangeMetaCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { code: string; state: string }) => {
    if (!data?.code || typeof data.code !== "string") {
      throw new Error("Código de autorização ausente");
    }
    if (!data?.state || typeof data.state !== "string") {
      throw new Error("State OAuth ausente");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { appId, appSecret, redirectUri, graphVersion } = getMetaConfig();
    const crmUser = await getAuthorizedCrmUser(context.userId);
    await verifySignedState(data.state, context.userId, crmUser.id_empresa, appSecret);

    const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", data.code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      console.error("Meta token exchange error", tokenJson);
      throw new Error(tokenJson?.error?.message ?? "Falha ao obter token do Meta");
    }

    const longUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", appId);
    longUrl.searchParams.set("client_secret", appSecret);
    longUrl.searchParams.set("fb_exchange_token", tokenJson.access_token);

    const longRes = await fetch(longUrl.toString());
    const longJson = await longRes.json();
    const accessToken: string = longJson?.access_token ?? tokenJson.access_token;

    const meUrl = new URL(`https://graph.facebook.com/${graphVersion}/me`);
    meUrl.searchParams.set("fields", "id,name");
    meUrl.searchParams.set("access_token", accessToken);
    const meRes = await fetch(meUrl.toString());
    const metaUser = await meRes.json();
    if (!meRes.ok || !metaUser?.id) {
      console.error("Meta /me error", metaUser);
      throw new Error("Não foi possível obter dados do usuário Meta");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: connection, error: connectionError } = await supabaseAdmin
      .from("crm_meta_connections")
      .upsert(
        {
          id_empresa: crmUser.id_empresa,
          user_id_meta: metaUser.id,
          user_name: metaUser.name ?? null,
          user_access_token: accessToken,
          connected_at: new Date().toISOString(),
          active: true,
        },
        { onConflict: "id_empresa" },
      )
      .select("id,user_name,user_id_meta,connected_at,active")
      .single();

    if (connectionError) throw new Error(connectionError.message);

    const sync = await syncMetaFormsForConnection({
      idEmpresa: crmUser.id_empresa,
      connectionId: connection.id,
      userAccessToken: accessToken,
      graphVersion,
    });

    return { ok: true as const, connection, sync };
  });

export const getMetaIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const crmUser = await getAuthorizedCrmUser(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: connection, error: connectionError } = await supabaseAdmin
      .from("crm_meta_connections")
      .select("id,user_name,user_id_meta,connected_at,active")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("active", true)
      .maybeSingle();
    if (connectionError) throw new Error(connectionError.message);

    const { data: forms, error: formsError } = await supabaseAdmin
      .from("crm_meta_forms")
      .select("id,form_id,form_name,page_id,page_name,leads_count,active")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("active", true)
      .order("page_name", { ascending: true });
    if (formsError) throw new Error(formsError.message);

    return {
      connection: (connection as MetaConnectionStatus | null) ?? null,
      forms: (forms ?? []) as MetaFormStatus[],
    };
  });

export const syncMetaForms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { graphVersion } = getMetaConfig(false);
    const crmUser = await getAuthorizedCrmUser(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: connection, error } = await supabaseAdmin
      .from("crm_meta_connections")
      .select("id,user_access_token")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("active", true)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!connection) throw new Error("Nenhuma conta Meta conectada");

    return syncMetaFormsForConnection({
      idEmpresa: crmUser.id_empresa,
      connectionId: connection.id,
      userAccessToken: connection.user_access_token,
      graphVersion,
    });
  });

export const disconnectMetaConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const crmUser = await getAuthorizedCrmUser(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: connectionError } = await supabaseAdmin
      .from("crm_meta_connections")
      .update({ active: false })
      .eq("id_empresa", crmUser.id_empresa);
    if (connectionError) throw new Error(connectionError.message);

    const { error: formsError } = await supabaseAdmin
      .from("crm_meta_forms")
      .update({ active: false })
      .eq("id_empresa", crmUser.id_empresa);
    if (formsError) throw new Error(formsError.message);

    return { ok: true as const };
  });
