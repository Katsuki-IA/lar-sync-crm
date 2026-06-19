import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_META_REDIRECT_URI = "https://lar-sync-crm.lovable.app/";
const DEFAULT_META_GRAPH_VERSION = "v21.0";
const META_SCOPES = [
  "leads_retrieval",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_ads",
  "pages_manage_metadata",
  "business_management",
].join(",");

type CrmUserAccess = {
  id_empresa: number;
  role: string;
};

type MetaPage = {
  id: string;
  name?: string;
  access_token?: string;
  source?: string;
};

type MetaLeadForm = {
  id: string;
  name?: string;
  leads_count?: number;
};

type MetaSyncPageResult = {
  pageId: string;
  pageName: string | null;
  formsCount: number;
  hasAccessToken: boolean;
  webhookSubscribed: boolean;
  source: string | null;
};

type MetaSyncPageError = {
  pageId: string;
  pageName: string | null;
  message: string;
};

type MetaSyncSource = {
  source: string;
  count: number;
  error: string | null;
};

type MetaBusiness = {
  id: string;
  name?: string;
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

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function handleOptions(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

export async function withErrorHandling(handler: () => Promise<Response>) {
  try {
    return await handler();
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Erro interno" }, 400);
  }
}

export function getMetaConfig(requireSecret = true) {
  const appId = Deno.env.get("META_APP_ID") ?? "1267473975460487";
  const appSecret = Deno.env.get("META_APP_SECRET") ?? "";
  const redirectUri = Deno.env.get("META_REDIRECT_URI") ?? DEFAULT_META_REDIRECT_URI;
  const graphVersion = Deno.env.get("META_GRAPH_VERSION") ?? DEFAULT_META_GRAPH_VERSION;

  if (requireSecret && !appSecret) {
    throw new Error("META_APP_SECRET não configurado no Supabase");
  }

  return { appId, appSecret, redirectUri, graphVersion };
}

export function createSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function getAuthorizedCrmUser(req: Request): Promise<{
  userId: string;
  crmUser: CrmUserAccess;
}> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Usuário não autenticado");
  }

  const token = authHeader.replace("Bearer ", "");
  const supabaseAdmin = createSupabaseAdmin();
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

  if (userError || !userData.user?.id) {
    throw new Error("Sessão inválida");
  }

  const { data, error } = await supabaseAdmin
    .from("crm_users")
    .select("id_empresa,role")
    .eq("auth_user_id", userData.user.id)
    .eq("active", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id_empresa) throw new Error("Usuário sem empresa vinculada");
  if (data.role !== "manager" && data.role !== "super_admin") {
    throw new Error("Apenas gestores podem configurar integrações");
  }

  return {
    userId: userData.user.id,
    crmUser: {
      id_empresa: data.id_empresa,
      role: data.role,
    },
  };
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

export async function createSignedState(
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

export async function verifySignedState(
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

export function buildMetaOAuthUrl(args: {
  appId: string;
  redirectUri: string;
  graphVersion: string;
  state: string;
}) {
  const url = new URL(`https://www.facebook.com/${args.graphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", args.appId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("scope", META_SCOPES);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("auth_type", "rerequest");
  url.searchParams.set("state", args.state);
  return url.toString();
}

export async function fetchGraphCollection<T>(initialUrl: URL | string): Promise<T[]> {
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

async function fetchGraphCollectionResult<T>(
  source: string,
  initialUrl: URL | string,
): Promise<{ source: string; items: T[]; error: string | null }> {
  try {
    return { source, items: await fetchGraphCollection<T>(initialUrl), error: null };
  } catch (error) {
    return {
      source,
      items: [],
      error: error instanceof Error ? error.message : "Falha ao consultar a Graph API",
    };
  }
}

async function fetchMetaPages(args: {
  userAccessToken: string;
  graphVersion: string;
}): Promise<{ pages: MetaPage[]; sources: MetaSyncSource[] }> {
  const pagesById = new Map<string, MetaPage>();
  const sources: MetaSyncSource[] = [];

  const addPages = (items: MetaPage[], source: string) => {
    for (const page of items) {
      const current = pagesById.get(page.id);
      pagesById.set(page.id, {
        id: page.id,
        name: page.name ?? current?.name,
        access_token: page.access_token ?? current?.access_token,
        source: current?.source ? `${current.source}, ${source}` : source,
      });
    }
  };

  const accountsUrl = new URL(`https://graph.facebook.com/${args.graphVersion}/me/accounts`);
  accountsUrl.searchParams.set("fields", "id,name,access_token");
  accountsUrl.searchParams.set("limit", "100");
  accountsUrl.searchParams.set("access_token", args.userAccessToken);
  const accounts = await fetchGraphCollectionResult<MetaPage>("/me/accounts", accountsUrl);
  sources.push({ source: accounts.source, count: accounts.items.length, error: accounts.error });
  addPages(accounts.items, accounts.source);

  const businessesUrl = new URL(`https://graph.facebook.com/${args.graphVersion}/me/businesses`);
  businessesUrl.searchParams.set("fields", "id,name");
  businessesUrl.searchParams.set("limit", "100");
  businessesUrl.searchParams.set("access_token", args.userAccessToken);
  const businesses = await fetchGraphCollectionResult<MetaBusiness>("/me/businesses", businessesUrl);
  sources.push({
    source: businesses.source,
    count: businesses.items.length,
    error: businesses.error,
  });

  for (const business of businesses.items) {
    for (const edge of ["owned_pages", "client_pages"] as const) {
      const businessPagesUrl = new URL(
        `https://graph.facebook.com/${args.graphVersion}/${business.id}/${edge}`,
      );
      businessPagesUrl.searchParams.set("fields", "id,name,access_token");
      businessPagesUrl.searchParams.set("limit", "100");
      businessPagesUrl.searchParams.set("access_token", args.userAccessToken);

      const source = `/businesses/${business.name ?? business.id}/${edge}`;
      const result = await fetchGraphCollectionResult<MetaPage>(source, businessPagesUrl);
      sources.push({ source: result.source, count: result.items.length, error: result.error });
      addPages(result.items, result.source);
    }
  }

  return { pages: Array.from(pagesById.values()), sources };
}

export async function syncMetaFormsForConnection(args: {
  idEmpresa: number;
  connectionId: string;
  userAccessToken: string;
  graphVersion: string;
}) {
  const supabaseAdmin = createSupabaseAdmin();
  const { pages, sources } = await fetchMetaPages({
    graphVersion: args.graphVersion,
    userAccessToken: args.userAccessToken,
  });
  const pageResults: MetaSyncPageResult[] = [];
  const pageErrors: MetaSyncPageError[] = [];
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
    if (!page.access_token) {
      pageResults.push({
        pageId: page.id,
        pageName: page.name ?? null,
        formsCount: 0,
        hasAccessToken: false,
        webhookSubscribed: false,
        source: page.source ?? null,
      });
      continue;
    }

    let webhookSubscribed = false;
    const subscriptionUrl = new URL(
      `https://graph.facebook.com/${args.graphVersion}/${page.id}/subscribed_apps`,
    );
    subscriptionUrl.searchParams.set("subscribed_fields", "leadgen");
    subscriptionUrl.searchParams.set("access_token", page.access_token);
    try {
      const subscriptionResponse = await fetch(subscriptionUrl.toString(), { method: "POST" });
      const subscriptionJson = await subscriptionResponse.json();
      const subscriptionSucceeded =
        subscriptionJson?.success === true || subscriptionJson?.success === "true";
      if (!subscriptionResponse.ok || subscriptionJson?.error || !subscriptionSucceeded) {
        throw new Error(
          subscriptionJson?.error?.message ?? "A Meta não confirmou a assinatura do webhook",
        );
      }
      webhookSubscribed = true;
    } catch (error) {
      pageErrors.push({
        pageId: page.id,
        pageName: page.name ?? null,
        message: `Webhook leadgen: ${
          error instanceof Error ? error.message : "falha ao inscrever a página"
        }`,
      });
      console.warn(`Falha ao inscrever webhook leadgen na página Meta ${page.id}`, error);
    }

    const formsUrl = new URL(
      `https://graph.facebook.com/${args.graphVersion}/${page.id}/leadgen_forms`,
    );
    formsUrl.searchParams.set("fields", "id,name,leads_count");
    formsUrl.searchParams.set("limit", "100");
    formsUrl.searchParams.set("access_token", page.access_token);

    try {
      const forms = await fetchGraphCollection<MetaLeadForm>(formsUrl);
      pageResults.push({
        pageId: page.id,
        pageName: page.name ?? null,
        formsCount: forms.length,
        hasAccessToken: true,
        webhookSubscribed,
        source: page.source ?? null,
      });
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
      pageResults.push({
        pageId: page.id,
        pageName: page.name ?? null,
        formsCount: 0,
        hasAccessToken: true,
        webhookSubscribed,
        source: page.source ?? null,
      });
      pageErrors.push({
        pageId: page.id,
        pageName: page.name ?? null,
        message: error instanceof Error ? error.message : "Falha ao sincronizar formulários",
      });
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

  return {
    pagesCount: pages.length,
    formsCount: rows.length,
    pages: pageResults,
    errors: pageErrors,
    sources,
  };
}
