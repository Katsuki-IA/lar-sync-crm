import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret, x-crm-dispatch-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Json =
  | null
  | string
  | number
  | boolean
  | { [key: string]: Json }
  | Json[];

type DispatchPayload = {
  leadId: number;
  idEmpresa: number;
  idEmpreendimento?: number;
  additionalTags?: string[];
  conversationSummary?: string;
  enforceScheduledRule?: boolean;
  externalStageKind?: string;
};

type CrmUser = {
  id: string;
  id_empresa: number | null;
  role: string;
};

type CvCredentials = {
  cv_crm_url: string | null;
  cv_crm_token: string | null;
  cv_crm_email: string | null;
  default_crm: string | null;
};

type RdCredentials = {
  default_crm: string | null;
  rd_user_id: string | null;
  rd_crm_access_token: string | null;
  rd_client_id: string | null;
  rd_client_secret: string | null;
  rd_refresh_token: string | null;
  rd_hub_access_token: string | null;
  rd_hub_client_id: string | null;
  rd_hub_client_secret: string | null;
  rd_hub_refresh_token: string | null;
  rd_hub_token_expires_at: string | null;
};

const RD_CREDENTIALS_SELECT =
  "default_crm,rd_user_id,rd_crm_access_token,rd_client_id,rd_client_secret,rd_refresh_token,rd_hub_access_token,rd_hub_client_id,rd_hub_client_secret,rd_hub_refresh_token,rd_hub_token_expires_at";

type ResolvedRdOAuthCredentials = {
  source: "hub" | "legacy";
  accessToken: string | null;
  clientId: string | null;
  clientSecret: string | null;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
};

type DispatchSettings = {
  stage_with_contact_id: number | null;
  external_stage_blocked_send_id: string | null;
  external_stage_qualified_id: string | null;
  external_stage_unqualified_id: string | null;
  external_stage_visit_scheduled_id: string | null;
  external_stage_lost_id: string | null;
  external_stage_without_whatsapp_id: string | null;
};

type DispatchStageOverride = Omit<DispatchSettings, "stage_with_contact_id">;

type CvSummaryResult = {
  ok: boolean;
  summary: string;
  used_fallback?: boolean;
  messages_count?: number;
  conversation_url?: string | null;
  whatsapp_url?: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function createSupabaseAdmin() {
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

function normalizeCrmKey(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function onlyDigits(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeLabel(value?: string | null) {
  return stripDiacritics(String(value ?? "").trim()).toLowerCase();
}

function buildWhatsAppUrl(phone?: string | null, empreendimento?: string | null) {
  const digits = onlyDigits(phone);
  if (!digits) return null;

  const text = empreendimento
    ? `Posso te ajudar com mais informacoes sobre ${stripDiacritics(empreendimento)}?`
    : "Posso te ajudar com mais informacoes?";

  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function appendConversationLinks(summary: string, conversationUrl: string, whatsappUrl: string | null) {
  const links = [summary.trim()];

  if (!summary.includes("Você pode ler a conversa completa através do link:")) {
    links.push(`Você pode ler a conversa completa através do link:\n${conversationUrl}`);
  }

  if (!summary.includes("Você pode atender o usuário através do link:")) {
    links.push(`Você pode atender o usuário através do link:\n${whatsappUrl ?? "Não disponível"}`);
  }

  return links
    .filter(Boolean)
    .join("\n\n")
    .replace(/(Você pode ler a conversa completa através do link:)\s*(https?:\/\/\S+)/g, "$1\n$2")
    .replace(/(Você pode atender o usuário através do link:)\s*(https?:\/\/\S+)/g, "$1\n$2");
}

function normalizeDispatchTags(value: unknown) {
  const supplied = Array.isArray(value)
    ? value.map((tag) => String(tag ?? "").trim()).filter(Boolean)
    : [];
  const seen = new Set<string>();

  return ["Atendimento IA", ...supplied].filter((tag) => {
    const normalized = normalizeLabel(tag);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function toScalarId(value?: string | null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return /^\d+$/.test(normalized) ? Number(normalized) : normalized;
}

function inferExternalId(payload: any): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
    payload.id,
    payload.lead_id,
    payload.idlead,
    payload.id_lead,
    payload?.data?.id,
    payload?.data?.lead_id,
    payload?.data?.idlead,
    payload?.lead?.id,
  ];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const normalized = String(candidate).trim();
    if (normalized) return normalized;
  }
  return null;
}

function isSuccessfulExportActivity(activity: { descricao?: string | null; metadata?: any }) {
  if (activity?.metadata?.event === "external_crm_sent") return true;
  return String(activity?.descricao ?? "").toLowerCase().includes("lead enviado ao crm") &&
    String(activity?.descricao ?? "").toLowerCase().includes("com sucesso");
}

async function parseResponsePayload(response: Response) {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function externalApiError(payload: any, fallback: string) {
  const direct = [payload?.message, payload?.error, payload?.errors?.[0]?.message]
    .find((value) => typeof value === "string" && value.trim());
  return direct ? String(direct) : fallback;
}

function requireRdCredential(value: string | null | undefined, label: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`A credencial RD ${label} não está configurada para esta empresa.`);
  return normalized;
}

function rdTokenExpiresAt(expiresIn: unknown) {
  const parsedSeconds = Number(expiresIn);
  const seconds = Number.isFinite(parsedSeconds) && parsedSeconds > 0 ? parsedSeconds : 7200;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function resolveRdOAuthCredentials(credentials: RdCredentials): ResolvedRdOAuthCredentials {
  const hubValues = [
    credentials.rd_hub_access_token,
    credentials.rd_hub_client_id,
    credentials.rd_hub_client_secret,
    credentials.rd_hub_refresh_token,
  ].map((value) => String(value ?? "").trim());
  const hasAnyHubCredential = hubValues.some(Boolean);
  const hasCompleteHubCredentials = hubValues.every(Boolean);

  if (hasAnyHubCredential && !hasCompleteHubCredentials) {
    throw new Error("As credenciais RD dedicadas ao Hub estão incompletas para esta empresa.");
  }

  if (hasCompleteHubCredentials) {
    return {
      source: "hub",
      accessToken: credentials.rd_hub_access_token,
      clientId: credentials.rd_hub_client_id,
      clientSecret: credentials.rd_hub_client_secret,
      refreshToken: credentials.rd_hub_refresh_token,
      tokenExpiresAt: credentials.rd_hub_token_expires_at,
    };
  }

  return {
    source: "legacy",
    accessToken: credentials.rd_crm_access_token,
    clientId: credentials.rd_client_id,
    clientSecret: credentials.rd_client_secret,
    refreshToken: credentials.rd_refresh_token,
    tokenExpiresAt: null,
  };
}

function hasFreshRdAccessToken(credentials: ResolvedRdOAuthCredentials) {
  if (!credentials.accessToken || !credentials.tokenExpiresAt) return false;
  const expiresAt = new Date(credentials.tokenExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000;
}

async function loadRdCredentials(
  admin: ReturnType<typeof createSupabaseAdmin>,
  idEmpresa: number,
) {
  const { data, error } = await admin
    .from("credentials")
    .select(RD_CREDENTIALS_SELECT)
    .eq("id_empresa", idEmpresa)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("As credenciais RD do Hub não foram encontradas para esta empresa.");
  return data as unknown as RdCredentials;
}

async function loadRotatedRdCredentials(
  admin: ReturnType<typeof createSupabaseAdmin>,
  idEmpresa: number,
  previousCredentials: ResolvedRdOAuthCredentials,
) {
  for (const delayMs of [100, 250, 500]) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const latest = await loadRdCredentials(admin, idEmpresa);
    const latestOAuth = resolveRdOAuthCredentials(latest);
    if (
      latestOAuth.accessToken &&
      (latestOAuth.source !== previousCredentials.source ||
        latestOAuth.refreshToken !== previousCredentials.refreshToken ||
        latestOAuth.accessToken !== previousCredentials.accessToken)
    ) {
      return latest;
    }
  }
  return null;
}

async function refreshRdCredentials(
  admin: ReturnType<typeof createSupabaseAdmin>,
  idEmpresa: number,
  credentials: RdCredentials,
) {
  const latestBeforeRefresh = await loadRdCredentials(admin, idEmpresa);
  const previousOAuth = resolveRdOAuthCredentials(credentials);
  const latestOAuth = resolveRdOAuthCredentials(latestBeforeRefresh);
  if (
    latestOAuth.source !== previousOAuth.source ||
    latestOAuth.refreshToken !== previousOAuth.refreshToken ||
    latestOAuth.accessToken !== previousOAuth.accessToken
  ) {
    return latestBeforeRefresh;
  }

  const credentialLabel = latestOAuth.source === "hub" ? "Hub" : "legada";
  const clientId = requireRdCredential(latestOAuth.clientId, `${credentialLabel} client_id`);
  const clientSecret = requireRdCredential(latestOAuth.clientSecret, `${credentialLabel} client_secret`);
  const refreshToken = requireRdCredential(latestOAuth.refreshToken, `${credentialLabel} refresh_token`);

  const response = await fetch("https://api.rd.services/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    const rotatedCredentials = await loadRotatedRdCredentials(admin, idEmpresa, latestOAuth);
    if (rotatedCredentials) return rotatedCredentials;
    throw new Error(externalApiError(payload, `RD Station retornou ${response.status} ao renovar o token.`));
  }

  const accessToken = requireRdCredential(payload?.access_token, "access_token retornado");
  const nextRefreshToken = requireRdCredential(payload?.refresh_token, "refresh_token retornado");
  const tokenExpiresAt = rdTokenExpiresAt(payload?.expires_in);
  const tokenUpdate = latestOAuth.source === "hub"
    ? {
      rd_hub_access_token: accessToken,
      rd_hub_refresh_token: nextRefreshToken,
      rd_hub_token_expires_at: tokenExpiresAt,
      updated_at: new Date().toISOString(),
    }
    : {
      rd_crm_access_token: accessToken,
      rd_refresh_token: nextRefreshToken,
      updated_at: new Date().toISOString(),
    };
  const refreshTokenColumn = latestOAuth.source === "hub" ? "rd_hub_refresh_token" : "rd_refresh_token";
  const { data, error } = await admin
    .from("credentials")
    .update(tokenUpdate)
    .eq("id_empresa", idEmpresa)
    .eq(refreshTokenColumn, refreshToken)
    .select(RD_CREDENTIALS_SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) return data as unknown as RdCredentials;
  return await loadRdCredentials(admin, idEmpresa);
}

async function requestToRd(
  admin: ReturnType<typeof createSupabaseAdmin>,
  idEmpresa: number,
  credentials: RdCredentials,
  path: string,
  body: Record<string, unknown>,
  method: "POST" | "PUT" = "POST",
) {
  const send = (accessToken: string) =>
    fetch(`https://api.rd.services/crm/v2/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

  let activeCredentials = await loadRdCredentials(admin, idEmpresa);
  let activeOAuth = resolveRdOAuthCredentials(activeCredentials);
  if (!activeOAuth.accessToken) {
    activeCredentials = credentials;
    activeOAuth = resolveRdOAuthCredentials(activeCredentials);
  }
  if (activeOAuth.tokenExpiresAt && !hasFreshRdAccessToken(activeOAuth)) {
    activeCredentials = await refreshRdCredentials(admin, idEmpresa, activeCredentials);
    activeOAuth = resolveRdOAuthCredentials(activeCredentials);
  }

  let accessToken = requireRdCredential(activeOAuth.accessToken, `${activeOAuth.source === "hub" ? "Hub" : "legada"} access_token`);
  let response = await send(accessToken);
  if (response.status !== 401) return response;

  const latestCredentials = await loadRdCredentials(admin, idEmpresa);
  const latestOAuth = resolveRdOAuthCredentials(latestCredentials);
  if (latestOAuth.accessToken && latestOAuth.accessToken !== accessToken) {
    activeCredentials = latestCredentials;
    activeOAuth = latestOAuth;
    accessToken = latestOAuth.accessToken;
    response = await send(accessToken);
    if (response.status !== 401) return response;
  }

  const refreshedCredentials = await refreshRdCredentials(admin, idEmpresa, activeCredentials);
  const refreshedOAuth = resolveRdOAuthCredentials(refreshedCredentials);
  response = await send(requireRdCredential(refreshedOAuth.accessToken, "access_token renovado"));
  return response;
}

async function authenticateDispatchRequest(
  supabaseAdmin: ReturnType<typeof createSupabaseAdmin>,
  req: Request,
  idEmpresa: number,
) {
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const apiKey = req.headers.get("apikey")?.trim() ?? "";
  const internalSecretHeader = req.headers.get("x-internal-secret")?.trim() ?? "";
  const crmDispatchToken = req.headers.get("x-crm-dispatch-token")?.trim() ?? "";
  const internalSecret = Deno.env.get("EXTERNAL_CRMS_INTERNAL_SECRET")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";

  const isInternalRequest =
    (internalSecret && (internalSecretHeader === internalSecret || bearerToken === internalSecret)) ||
    (serviceRoleKey && (apiKey === serviceRoleKey || bearerToken === serviceRoleKey));

  if (isInternalRequest) {
    return { crmUserId: null as string | null, internal: true };
  }

  if (crmDispatchToken) {
    const { data: credentials, error: credentialsError } = await supabaseAdmin
      .from("credentials")
      .select("cv_crm_token,rd_crm_access_token,rd_hub_access_token")
      .eq("id_empresa", idEmpresa)
      .maybeSingle();
    if (credentialsError) throw new Error(credentialsError.message);
    const validTokens = [
      credentials?.cv_crm_token,
      credentials?.rd_crm_access_token,
      credentials?.rd_hub_access_token,
    ]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    if (validTokens.includes(crmDispatchToken)) {
      return { crmUserId: null as string | null, internal: true };
    }
  }

  if (!bearerToken) {
    throw new Error("Acesso interno inválido");
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(bearerToken);
  if (authError || !authData.user) {
    throw new Error("Acesso interno inválido");
  }

  const { data: crmUser, error: crmUserError } = await supabaseAdmin
    .from("crm_users")
    .select("id,id_empresa,role")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();

  if (crmUserError || !crmUser) {
    throw new Error("Usuário do CRM não encontrado");
  }

  if (crmUser.role !== "super_admin" && !(crmUser.role === "manager" && crmUser.id_empresa === idEmpresa)) {
    throw new Error("Sem permissão para enviar lead desta empresa");
  }

  return { crmUserId: (crmUser as CrmUser).id, internal: false };
}

async function invokeCvSummaryFunction(args: {
  leadId: number;
  idEmpresa: number;
}) {
  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") ?? "").trim();
  const internalSecret = Deno.env.get("EXTERNAL_CRMS_INTERNAL_SECRET")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL ausente para gerar resumo do CV.");
  }

  if (!internalSecret && !serviceRoleKey) {
    throw new Error("Nenhuma credencial interna disponível para gerar resumo do CV.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (internalSecret) {
    headers["x-internal-secret"] = internalSecret;
  } else if (serviceRoleKey) {
    headers.apikey = serviceRoleKey;
    headers.Authorization = `Bearer ${serviceRoleKey}`;
  }

  const response = await fetch(`${trimTrailingSlash(supabaseUrl)}/functions/v1/external-crms-cv-summary`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      leadId: args.leadId,
      idEmpresa: args.idEmpresa,
    }),
  });

  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    const message =
      (typeof payload?.error === "string" && payload.error) ||
      (typeof payload?.message === "string" && payload.message) ||
      `Resumo CV retornou ${response.status}`;
    throw new Error(message);
  }

  return payload as CvSummaryResult;
}

async function resolveLeadDestination(
  admin: ReturnType<typeof createSupabaseAdmin>,
  lead: {
    id: number;
    id_empresa: number;
    id_empreendimento: number | null;
  },
  preferredEmpreendimentoId?: number | null,
) {
  let localEmpreendimentoId = preferredEmpreendimentoId ?? lead.id_empreendimento;

  if (!localEmpreendimentoId) {
    const { data: leadContext, error: leadContextError } = await admin
      .from("lead")
      .select("empreendimento_em_foco_id")
      .eq("id_empresa", lead.id_empresa)
      .eq("id_crm", String(lead.id))
      .order("updated_at", { ascending: false })
      .limit(1);
    if (leadContextError) throw new Error(leadContextError.message);
    localEmpreendimentoId = leadContext?.[0]?.empreendimento_em_foco_id ?? null;
  }

  let cvEmpreendimentoId: string | number | null = null;
  let empreendimentoNome: string | null = null;
  if (localEmpreendimentoId) {
    const { data: empreendimento, error: empreendimentoError } = await admin
      .from("empreendimento")
      .select("cv_id_empreendimento,nome")
      .eq("id", localEmpreendimentoId)
      .eq("id_empresa", lead.id_empresa)
      .maybeSingle();
    if (empreendimentoError) throw new Error(empreendimentoError.message);
    cvEmpreendimentoId = toScalarId(empreendimento?.cv_id_empreendimento ?? null);
    empreendimentoNome = empreendimento?.nome?.trim() || null;
  }

  return {
    localEmpreendimentoId,
    cvEmpreendimentoId,
    empreendimentoNome,
  };
}

async function loadLeadTagNames(
  admin: ReturnType<typeof createSupabaseAdmin>,
  leadId: number,
  idEmpresa: number,
) {
  const { data: tagLinks, error: tagLinksError } = await admin
    .from("crm_lead_tags")
    .select("tag_id")
    .eq("lead_id", leadId);
  if (tagLinksError) throw new Error(tagLinksError.message);

  const tagIds = (tagLinks ?? [])
    .map((link: any) => Number(link.tag_id))
    .filter((tagId: number) => Number.isFinite(tagId));
  if (!tagIds.length) return [];

  const { data: tags, error: tagsError } = await admin
    .from("crm_tags")
    .select("nome")
    .eq("id_empresa", idEmpresa)
    .in("id", tagIds);
  if (tagsError) throw new Error(tagsError.message);

  return (tags ?? [])
    .map((tag: any) => String(tag.nome ?? "").trim())
    .filter(Boolean);
}

function resolveExternalStageId(
  stageName: string | null,
  settings: DispatchSettings,
  override?: DispatchStageOverride | null,
  leadTagNames: string[] = [],
  externalStageKind?: string | null,
) {
  const stageValue = (key: keyof DispatchStageOverride) =>
    String(override?.[key] ?? settings[key] ?? "").trim() || String(settings[key] ?? "").trim();
  const blockedSend = stageValue("external_stage_blocked_send_id");
  const qualified = stageValue("external_stage_qualified_id");
  const unqualified = stageValue("external_stage_unqualified_id");
  const visitScheduled = stageValue("external_stage_visit_scheduled_id");
  const lost = stageValue("external_stage_lost_id");
  const withoutWhatsapp = stageValue("external_stage_without_whatsapp_id");
  const hasQualifiedTag = leadTagNames.some((tagName) => normalizeLabel(tagName) === "qualificado");

  if (!unqualified) {
    throw new Error("O ID externo de Não qualificado não está configurado para esta empresa.");
  }

  if (normalizeLabel(externalStageKind) === "without_whatsapp") return withoutWhatsapp || unqualified;
  if (stageName === "Perdido") return lost || unqualified;
  if (stageName === "Visita Agendada") return visitScheduled || unqualified;
  if (hasQualifiedTag) return qualified || unqualified;
  if (stageName === "Bloqueio Envio") return blockedSend || unqualified;
  return unqualified;
}

async function moveLeadToSentStage(
  admin: ReturnType<typeof createSupabaseAdmin>,
  leadId: number,
  idEmpresa: number,
) {
  let sentStage =
    (await admin
      .from("crm_stages")
      .select("id,nome")
      .eq("id_empresa", idEmpresa)
      .eq("nome", "Enviado ao CRM")
      .eq("ativo", true)
      .limit(1)).data?.[0] ?? null;

  if (!sentStage) {
    const syncResult = await admin.rpc("crm_sync_company_global_config", {
      p_id_empresa: idEmpresa,
    });
    if (syncResult.error) throw new Error(syncResult.error.message);

    const retry = await admin
      .from("crm_stages")
      .select("id,nome")
      .eq("id_empresa", idEmpresa)
      .eq("nome", "Enviado ao CRM")
      .eq("ativo", true)
      .limit(1);
    if (retry.error) throw new Error(retry.error.message);
    sentStage = retry.data?.[0] ?? null;
  }

  if (!sentStage) return null;

  const { data: leadBefore, error: leadBeforeError } = await admin
    .from("crm_leads")
    .select("crm_stage_id")
    .eq("id", leadId)
    .maybeSingle();
  if (leadBeforeError) throw new Error(leadBeforeError.message);

  if (leadBefore?.crm_stage_id === sentStage.id) {
    return sentStage;
  }

  const oldStageId = leadBefore?.crm_stage_id ?? null;
  const oldStageName =
    oldStageId != null
      ? (
          await admin
            .from("crm_stages")
            .select("nome")
            .eq("id", oldStageId)
            .limit(1)
        ).data?.[0]?.nome ?? "—"
      : "—";

  const { error: updateError } = await admin
    .from("crm_leads")
    .update({ crm_stage_id: sentStage.id, updated_at: new Date().toISOString() })
    .eq("id", leadId);
  if (updateError) throw new Error(updateError.message);

  return {
    ...sentStage,
    oldStageId,
    oldStageName,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Método não permitido" }, 405);
    }

    const body = (await req.json()) as Partial<DispatchPayload>;
    const leadId = Number(body.leadId);
    const idEmpresa = Number(body.idEmpresa);

    if (!Number.isFinite(leadId) || !Number.isFinite(idEmpresa)) {
      throw new Error("leadId e idEmpresa são obrigatórios");
    }

    const admin = createSupabaseAdmin();
    const authContext = await authenticateDispatchRequest(admin, req, idEmpresa);
    const aiUserIdResult = await admin.rpc("crm_get_or_create_ai_user", { p_id_empresa: idEmpresa });
    if (aiUserIdResult.error) throw new Error(aiUserIdResult.error.message);
    const activityUserId = authContext.crmUserId ?? (aiUserIdResult.data as string | null);

    const { data: lead, error: leadError } = await admin
      .from("crm_leads")
      .select("id,id_empresa,nome,telefone,email,crm_stage_id,id_empreendimento,historico_token")
      .eq("id", leadId)
      .eq("id_empresa", idEmpresa)
      .maybeSingle();
    if (leadError) throw new Error(leadError.message);
    if (!lead) throw new Error("Lead não encontrado.");

    const { data: previousExportActivities, error: previousExportActivitiesError } = await admin
      .from("crm_lead_activities")
      .select("id,descricao,metadata")
      .eq("lead_id", lead.id)
      .eq("tipo", "crm_export");
    if (previousExportActivitiesError) throw new Error(previousExportActivitiesError.message);

    if ((previousExportActivities ?? []).some(isSuccessfulExportActivity)) {
      throw new Error("Este lead já foi enviado para o CRM.");
    }

    const [{ data: empresa, error: empresaError }, { data: credentials, error: credentialsError }] =
      await Promise.all([
        admin
          .from("empresa_dados")
          .select("id,nome,default_crm")
          .eq("id", lead.id_empresa)
          .maybeSingle(),
        admin
          .from("credentials")
          .select(`cv_crm_url,cv_crm_token,cv_crm_email,${RD_CREDENTIALS_SELECT}`)
          .eq("id_empresa", lead.id_empresa)
          .maybeSingle(),
      ]);

    if (empresaError) throw new Error(empresaError.message);
    if (credentialsError) throw new Error(credentialsError.message);
    if (!empresa) throw new Error("Empresa do lead não encontrada.");

    const crmKey = normalizeCrmKey(empresa.default_crm) ||
      normalizeCrmKey((credentials as CvCredentials | null)?.default_crm);
    const isCvCrm = ["cv", "cv_crm"].includes(crmKey);
    const isRdCrm = ["rd", "rd_crm", "rdstation", "rd_station"].includes(crmKey);
    if (!isCvCrm && !isRdCrm) throw new Error("O CRM padrão desta empresa não é suportado para envio.");

    const cvCredentials = credentials as CvCredentials | null;
    const cvUrl = trimTrailingSlash(String(cvCredentials?.cv_crm_url ?? "").trim());
    const cvToken = String(cvCredentials?.cv_crm_token ?? "").trim();
    const cvEmail = String(cvCredentials?.cv_crm_email ?? "").trim();

    if (isCvCrm && (!cvUrl || !cvToken || !cvEmail)) {
      throw new Error("As credenciais do CV CRM estão incompletas para esta empresa.");
    }

    const dispatchSettingsResult = await admin
      .from("crm_lead_dispatch_settings")
      .select("stage_with_contact_id,external_stage_blocked_send_id,external_stage_qualified_id,external_stage_unqualified_id,external_stage_visit_scheduled_id,external_stage_lost_id,external_stage_without_whatsapp_id")
      .eq("id_empresa", lead.id_empresa)
      .maybeSingle();
    if (dispatchSettingsResult.error) throw new Error(dispatchSettingsResult.error.message);
    const dispatchSettings = (dispatchSettingsResult.data ?? {
      stage_with_contact_id: null,
      external_stage_blocked_send_id: null,
      external_stage_qualified_id: null,
      external_stage_unqualified_id: null,
      external_stage_visit_scheduled_id: null,
      external_stage_lost_id: null,
      external_stage_without_whatsapp_id: null,
    }) as DispatchSettings;

    const stageResult = lead.crm_stage_id
      ? await admin
          .from("crm_stages")
          .select("id,nome")
          .eq("id", lead.crm_stage_id)
          .limit(1)
      : { data: [], error: null };
    if (stageResult.error) throw new Error(stageResult.error.message);
    const currentStageName = stageResult.data?.[0]?.nome ?? null;

    if (body.enforceScheduledRule === true) {
      const scheduledStageId = Number(dispatchSettings.stage_with_contact_id);
      if (!Number.isFinite(scheduledStageId) || scheduledStageId !== Number(lead.crm_stage_id)) {
        return jsonResponse({
          ok: true,
          skipped: true,
          reason: "visit_scheduled_rule_not_enabled",
          configured_stage_id: Number.isFinite(scheduledStageId) ? scheduledStageId : null,
          current_stage_id: lead.crm_stage_id,
        });
      }
    }

    const requestedEmpreendimentoId = Number(body.idEmpreendimento);
    const preferredEmpreendimentoId = authContext.internal && Number.isSafeInteger(requestedEmpreendimentoId) && requestedEmpreendimentoId > 0
      ? requestedEmpreendimentoId
      : null;
    const { localEmpreendimentoId, cvEmpreendimentoId, empreendimentoNome } = await resolveLeadDestination(
      admin,
      lead,
      preferredEmpreendimentoId,
    );
    const stageOverrideResult = localEmpreendimentoId
      ? await admin
          .from("crm_lead_dispatch_stage_overrides")
          .select("external_stage_blocked_send_id,external_stage_qualified_id,external_stage_unqualified_id,external_stage_visit_scheduled_id,external_stage_lost_id,external_stage_without_whatsapp_id")
          .eq("id_empresa", lead.id_empresa)
          .eq("id_empreendimento", localEmpreendimentoId)
          .maybeSingle()
      : { data: null, error: null };
    if (stageOverrideResult.error) throw new Error(stageOverrideResult.error.message);
    const leadTagNames = await loadLeadTagNames(admin, lead.id, lead.id_empresa);
    const externalStageId = resolveExternalStageId(
      currentStageName,
      dispatchSettings,
      stageOverrideResult.data as DispatchStageOverride | null,
      leadTagNames,
      body.externalStageKind,
    );
    const appBaseUrl = (Deno.env.get("APP_BASE_URL")?.trim() || "https://hub.katsuki.com.br").replace(/\/+$/, "");
    const conversationUrl = `${appBaseUrl}/historico/${lead.historico_token ?? lead.id}`;
    const whatsappUrl = buildWhatsAppUrl(lead.telefone, empreendimentoNome);

    const provider = isCvCrm ? "cv_crm" : "rd_crm";
    const providerLabel = isCvCrm ? "CV" : "RD";
    const email = String(lead.email ?? "").trim();
    const phone = String(lead.telefone ?? "").trim();
    const requestedTags = normalizeDispatchTags(body.additionalTags);
    const tags = isCvCrm
      ? normalizeDispatchTags([...leadTagNames, ...requestedTags])
      : requestedTags;
    let requestPayload: Record<string, unknown> = {};
    let responsePayload: Json | Record<string, unknown> | null = null;
    let summaryPayload: CvSummaryResult | null = null;
    let summaryErrorMessage: string | null = null;
    let conversationSummarySynced = false;
    let externalId: string | null = null;
    const suppliedSummary = String(body.conversationSummary ?? "").trim();
    const isWithoutWhatsappStage = normalizeLabel(body.externalStageKind) === "without_whatsapp";

    try {
      if (suppliedSummary || isWithoutWhatsappStage) {
        summaryPayload = {
          ok: true,
          summary: isWithoutWhatsappStage
            ? suppliedSummary || "Lead sem WhatsApp ou telefone."
            : appendConversationLinks(suppliedSummary, conversationUrl, whatsappUrl),
          used_fallback: false,
          conversation_url: conversationUrl,
          whatsapp_url: whatsappUrl,
        };
      } else {
        try {
          summaryPayload = await invokeCvSummaryFunction({
            leadId: lead.id,
            idEmpresa: lead.id_empresa,
          });
        } catch (error) {
          summaryErrorMessage = error instanceof Error
            ? error.message
            : "Falha ao gerar resumo da conversa para envio ao CRM.";
        }
      }

      if (isCvCrm) {
        requestPayload = {
          telefone: phone,
          nome: String(lead.nome ?? "").trim() || "Lead sem nome",
          origem: "WA",
          idsituacao: toScalarId(externalStageId),
          permitir_alteracao: true,
          tags,
        };
        if (email) requestPayload.email = email;
        if (cvEmpreendimentoId != null) requestPayload.idempreendimento = cvEmpreendimentoId;

        if (summaryPayload?.summary) {
          requestPayload.interacoes = [{ descricao: summaryPayload.summary, tipo: "W" }];
          conversationSummarySynced = true;
        }

        const response = await fetch(`${cvUrl}/api/v1/comercial/leads`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            token: cvToken,
            email: cvEmail,
            origemcv: "true",
          },
          body: JSON.stringify(requestPayload),
        });
        responsePayload = await parseResponsePayload(response);
        if (!response.ok) throw new Error(externalApiError(responsePayload, `CV CRM retornou ${response.status}`));
        externalId = inferExternalId(responsePayload);
      } else {
        if (!phone && !email) throw new Error("O lead precisa ter telefone ou e-mail para ser enviado ao RD.");

        const rdCredentials = credentials as RdCredentials;
        const contactName = String(lead.nome ?? "").trim();
        const contactData: Record<string, unknown> = {
          name: contactName.length >= 3 ? contactName : "Cliente sem nome",
        };
        if (email) contactData.emails = [{ email }];
        if (phone) contactData.phones = [{ phone }];

        const contactRequestPayload = { data: contactData };
        requestPayload = { create_contact: contactRequestPayload };
        const contactResponse = await requestToRd(admin, lead.id_empresa, rdCredentials, "contacts", contactRequestPayload);
        const contactPayload = await parseResponsePayload(contactResponse);
        if (!contactResponse.ok) {
          responsePayload = { create_contact: contactPayload };
          throw new Error(externalApiError(contactPayload, `RD Station retornou ${contactResponse.status} ao criar o contato.`));
        }

        const contactId = inferExternalId(contactPayload);
        if (!contactId) {
          responsePayload = { create_contact: contactPayload };
          throw new Error("A RD Station não retornou o ID do contato criado.");
        }

        const dealRequestPayload = {
          data: {
            owner_id: requireRdCredential(rdCredentials.rd_user_id, "user_id"),
            name: String(contactData.name),
            status: "ongoing",
            stage_id: externalStageId,
            expected_close_date: new Date().toISOString().slice(0, 10),
            contact_ids: [contactId],
            custom_fields: { tags },
          },
        };
        requestPayload = { create_contact: contactRequestPayload, create_deal: dealRequestPayload };
        const dealResponse = await requestToRd(admin, lead.id_empresa, rdCredentials, "deals", dealRequestPayload);
        const dealPayload = await parseResponsePayload(dealResponse);
        responsePayload = { create_contact: contactPayload, create_deal: dealPayload };
        if (!dealResponse.ok) {
          throw new Error(externalApiError(dealPayload, `RD Station retornou ${dealResponse.status} ao criar a negociação.`));
        }
        externalId = inferExternalId(dealPayload);

        if (summaryPayload?.summary && externalId) {
          const createDealNotePayload = {
            data: {
              description: summaryPayload.summary,
              user_id: requireRdCredential(rdCredentials.rd_user_id, "user_id"),
            },
          };
          requestPayload = {
            create_contact: contactRequestPayload,
            create_deal: dealRequestPayload,
            create_deal_note: createDealNotePayload,
          };
          const createDealNoteResponse = await requestToRd(
            admin,
            lead.id_empresa,
            rdCredentials,
            `deals/${externalId}/notes`,
            createDealNotePayload,
          );
          const createDealNoteResult = await parseResponsePayload(createDealNoteResponse);
          responsePayload = {
            create_contact: contactPayload,
            create_deal: dealPayload,
            create_deal_note: createDealNoteResult,
          };
          if (!createDealNoteResponse.ok) {
            summaryErrorMessage = externalApiError(
              createDealNoteResult,
              `RD Station retornou ${createDealNoteResponse.status} ao criar a anotação da negociação.`,
            );
          } else {
            conversationSummarySynced = true;
          }
        }
      }

      await admin.from("crm_external_crm_send_logs").insert({
        id_empresa: lead.id_empresa,
        lead_id: lead.id,
        provider,
        request_payload: requestPayload,
        status: "sent",
        response_payload: {
          dispatch: responsePayload,
          conversation_summary: summaryPayload,
          summary_error: summaryErrorMessage,
        },
        external_id: externalId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Falha ao enviar lead para o CRM externo.";
      await admin.from("crm_external_crm_send_logs").insert({
        id_empresa: lead.id_empresa,
        lead_id: lead.id,
        provider,
        request_payload: requestPayload,
        status: "failed",
        response_payload: responsePayload,
        error_message: errorMessage,
      });
      await admin.from("crm_lead_activities").insert({
        lead_id: lead.id,
        crm_user_id: activityUserId,
        tipo: "crm_export",
        descricao: `Falha ao enviar lead ao CRM ${providerLabel}: ${errorMessage}`,
        metadata: {
          source: authContext.internal ? "n8n" : "crm",
          event: "external_crm_failed",
          provider,
          response: responsePayload,
        },
      });
      throw error;
    }

      let externalLeadStatusErrorMessage: string | null = null;
      const externalLeadStatusUpdate = await admin
        .from("lead")
        .update({
          status: "Enviado  CRM",
          updated_at: new Date().toISOString(),
        })
        .eq("id_empresa", lead.id_empresa)
        .eq("id_crm", String(lead.id))
        .select("id")
        .limit(1);

      if (externalLeadStatusUpdate.error) {
        externalLeadStatusErrorMessage = externalLeadStatusUpdate.error.message;
      } else if (!externalLeadStatusUpdate.data?.length) {
        externalLeadStatusErrorMessage =
          "Nenhum registro correspondente foi encontrado na tabela lead para marcar status como Enviado  CRM.";
      }

      const sentStage = await moveLeadToSentStage(admin, lead.id, lead.id_empresa);

      if (sentStage?.oldStageId != null && sentStage.oldStageId !== sentStage.id) {
        await admin.from("crm_lead_activities").insert({
          lead_id: lead.id,
          crm_user_id: activityUserId,
          tipo: "stage_change",
          descricao: `De ${sentStage.oldStageName ?? "—"} para ${sentStage.nome}`,
          metadata: {
            source: authContext.internal ? "n8n" : "crm",
            event: "lead_sent_to_external_crm_stage_change",
            provider,
            old_stage_id: sentStage.oldStageId,
            new_stage_id: sentStage.id,
          },
        });
      }

      await admin.from("crm_lead_activities").insert({
        lead_id: lead.id,
        crm_user_id: activityUserId,
        tipo: "crm_export",
        descricao: `Lead enviado ao CRM ${providerLabel} com sucesso`,
        metadata: {
          source: authContext.internal ? "n8n" : "crm",
          event: "external_crm_sent",
          provider,
          external_id: externalId,
          id_empreendimento_local: localEmpreendimentoId,
          external_empreendimento_id: isCvCrm ? cvEmpreendimentoId : null,
          external_stage_id: isCvCrm ? toScalarId(externalStageId) : externalStageId,
          qualified_by_tag: leadTagNames.some((tagName) => normalizeLabel(tagName) === "qualificado"),
          conversation_summary_synced: conversationSummarySynced,
          conversation_summary_error: summaryErrorMessage,
          conversation_summary_used_fallback: summaryPayload?.used_fallback ?? false,
          external_lead_status_updated: !externalLeadStatusErrorMessage,
          external_lead_status_error: externalLeadStatusErrorMessage,
        },
      });

      if (summaryErrorMessage) {
        await admin.from("crm_lead_activities").insert({
          lead_id: lead.id,
          crm_user_id: activityUserId,
          tipo: "crm_export",
          descricao: `Lead enviado ao CRM ${providerLabel} sem resumo de conversa: ${summaryErrorMessage}`,
          metadata: {
            source: authContext.internal ? "n8n" : "crm",
            event: "external_crm_summary_generation_failed",
            provider,
            external_id: externalId,
          },
        });
      }

      if (externalLeadStatusErrorMessage) {
        await admin.from("crm_lead_activities").insert({
          lead_id: lead.id,
          crm_user_id: activityUserId,
          tipo: "crm_export",
          descricao: `Lead enviado ao CRM ${providerLabel}, mas não foi possível atualizar o status externo para Enviado  CRM: ${externalLeadStatusErrorMessage}`,
          metadata: {
            source: authContext.internal ? "n8n" : "crm",
            event: "external_crm_external_lead_status_update_failed",
            provider,
            external_id: externalId,
          },
        });
      }

      return jsonResponse({
        ok: true,
        provider,
        moved_to_stage: sentStage?.id ?? null,
        conversation_summary_synced: conversationSummarySynced,
        external_lead_status_updated: !externalLeadStatusErrorMessage,
        summary_error: summaryErrorMessage,
      });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro interno" },
      400,
    );
  }
});
