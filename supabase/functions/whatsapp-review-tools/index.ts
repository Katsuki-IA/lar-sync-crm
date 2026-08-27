import {
  createSupabaseAdmin,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import {
  assertWhatsAppConnectionAllowed,
  decryptSecret,
  getAuthorizedWhatsAppTarget,
  getWhatsAppConfig,
  graphRequest,
} from "../_shared/whatsapp-embedded.ts";

type ReviewAction = "get_state" | "create_template" | "send_template";

type ReviewInput = {
  action?: ReviewAction;
  empresaId?: unknown;
  name?: unknown;
  category?: unknown;
  language?: unknown;
  body?: unknown;
  examples?: unknown;
  to?: unknown;
  parameters?: unknown;
};

type ConnectionRow = {
  id: string;
  id_empresa: number;
  waba_id: string;
  business_name: string | null;
  access_token_ciphertext: string;
  status: string;
  activation_status: string;
};

type PhoneRow = {
  phone_number_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
};

type MetaTemplate = {
  id?: string;
  name: string;
  status?: string;
  category?: string;
  language: string;
  components?: Array<Record<string, unknown>>;
  rejected_reason?: string;
  quality_score?: Record<string, unknown>;
};

type ReviewContext = {
  admin: ReturnType<typeof createSupabaseAdmin>;
  connection: ConnectionRow;
  phones: PhoneRow[];
  accessToken: string;
  graphVersion: string;
};

function requiredText(value: unknown, label: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) throw new Error(`${label} inválido`);
  return text;
}

function normalizeTemplateName(value: unknown) {
  const name = requiredText(value, "Nome do modelo", 512).toLowerCase();
  if (!/^[a-z0-9_]+$/u.test(name)) {
    throw new Error("O nome do modelo deve usar somente letras minúsculas, números e sublinhado");
  }
  return name;
}

function normalizeLanguage(value: unknown) {
  const language = requiredText(value, "Idioma", 20);
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/u.test(language)) {
    throw new Error("Código de idioma inválido");
  }
  return language;
}

function bodyParameterCount(body: string) {
  const indexes = Array.from(body.matchAll(/\{\{(\d+)\}\}/gu), (match) => Number(match[1]));
  const unique = Array.from(new Set(indexes)).sort((left, right) => left - right);
  for (let index = 0; index < unique.length; index += 1) {
    if (unique[index] !== index + 1) {
      throw new Error("As variáveis do modelo devem ser sequenciais: {{1}}, {{2}}, ...");
    }
  }
  return unique.length;
}

function normalizeStringArray(value: unknown, expected: number, label: string) {
  if (!Array.isArray(value)) {
    if (expected === 0) return [];
    throw new Error(`${label} inválidos`);
  }
  const normalized = value.map((item) => String(item ?? "").trim());
  if (normalized.length !== expected || normalized.some((item) => !item || item.length > 1024)) {
    throw new Error(`Informe ${expected} valor(es) válido(s) para ${label.toLowerCase()}`);
  }
  return normalized;
}

function normalizeOutboundStatus(value: unknown) {
  return typeof value === "string" &&
    new Set(["accepted", "sent", "delivered", "read", "failed"]).has(value)
    ? value
    : "accepted";
}

async function getReviewContext(req: Request, empresaId: unknown): Promise<ReviewContext> {
  const { idEmpresa } = await getAuthorizedWhatsAppTarget(req, empresaId);
  await assertWhatsAppConnectionAllowed(idEmpresa);
  const admin = createSupabaseAdmin();
  const { data: connection, error: connectionError } = await admin
    .from("crm_whatsapp_connections")
    .select("id,id_empresa,waba_id,business_name,access_token_ciphertext,status,activation_status")
    .eq("id_empresa", idEmpresa)
    .eq("status", "connected")
    .maybeSingle();
  if (connectionError) throw new Error(connectionError.message);
  if (!connection)
    throw new Error("Conecte uma conta do WhatsApp antes de usar o ambiente de teste");
  if (connection.activation_status !== "test") {
    throw new Error("Esta ferramenta é restrita às conexões isoladas em modo de teste");
  }

  const { data: phones, error: phonesError } = await admin
    .from("crm_whatsapp_phone_numbers")
    .select("phone_number_id,display_phone_number,verified_name")
    .eq("connection_id", connection.id)
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (phonesError) throw new Error(phonesError.message);
  if (!phones?.length) throw new Error("A conexão não possui um número ativo");

  const config = getWhatsAppConfig(true);
  return {
    admin,
    connection: connection as ConnectionRow,
    phones: phones as PhoneRow[],
    accessToken: await decryptSecret(connection.access_token_ciphertext, config.encryptionKey),
    graphVersion: config.graphVersion,
  };
}

async function fetchTemplates(context: ReviewContext) {
  return graphRequest<{ data?: MetaTemplate[] }>(
    { graphVersion: context.graphVersion },
    `${context.connection.waba_id}/message_templates?fields=id,name,status,category,language,components,rejected_reason,quality_score&limit=100`,
    context.accessToken,
  );
}

async function insertReviewEvent(
  context: ReviewContext,
  input: {
    eventType: string;
    eventKey: string;
    phoneNumberId?: string | null;
    messageId?: string | null;
    payload: unknown;
    occurredAt?: string;
  },
) {
  const { error } = await context.admin.from("crm_whatsapp_review_events").upsert(
    {
      id_empresa: context.connection.id_empresa,
      connection_id: context.connection.id,
      phone_number_id: input.phoneNumberId ?? null,
      source: "hub",
      event_type: input.eventType,
      event_key: input.eventKey,
      message_id: input.messageId ?? null,
      payload: input.payload,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
    },
    { onConflict: "event_key", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
}

async function getState(context: ReviewContext) {
  const phoneIds = context.phones.map((phone) => phone.phone_number_id);
  const [messagesResult, statusesResult, eventsResult] = await Promise.all([
    context.admin
      .from("wa_messages")
      .select(
        "id,message_id,direction,from_wa_id,to_wa_id,contact_name,type,text_body,template_name,template_language,template_variables,timestamp_meta,status_current,status_last_at,error_code,error_message,raw,created_at",
      )
      .in("phone_number_id", phoneIds)
      .order("timestamp_meta", { ascending: false, nullsFirst: false })
      .limit(100),
    context.admin
      .from("wa_message_status_events")
      .select(
        "id,phone_number_id,message_id,recipient_id,status,timestamp_meta,error_code,error_message,raw,created_at",
      )
      .in("phone_number_id", phoneIds)
      .order("timestamp_meta", { ascending: false, nullsFirst: false })
      .limit(100),
    context.admin
      .from("crm_whatsapp_review_events")
      .select(
        "id,phone_number_id,source,event_type,event_key,message_id,payload,occurred_at,created_at",
      )
      .eq("id_empresa", context.connection.id_empresa)
      .order("occurred_at", { ascending: false })
      .limit(100),
  ]);
  if (messagesResult.error) throw new Error(messagesResult.error.message);
  if (statusesResult.error) throw new Error(statusesResult.error.message);
  if (eventsResult.error) throw new Error(eventsResult.error.message);

  let templates: MetaTemplate[] = [];
  let templatesError: string | null = null;
  try {
    templates = (await fetchTemplates(context)).data ?? [];
  } catch (error) {
    templatesError = error instanceof Error ? error.message : "Falha ao consultar modelos";
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  return jsonResponse({
    connection: {
      wabaId: context.connection.waba_id,
      businessName: context.connection.business_name,
    },
    phones: context.phones,
    templates,
    templatesError,
    messages: messagesResult.data ?? [],
    statusEvents: statusesResult.data ?? [],
    events: eventsResult.data ?? [],
    webhook: {
      callbackUrl: supabaseUrl ? `${supabaseUrl}/functions/v1/whatsapp-review-webhook` : null,
      verifyTokenConfigured: Boolean(
        Deno.env.get("META_WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? Deno.env.get("N8N_WHATS_SECRET"),
      ),
    },
  });
}

async function createTemplate(context: ReviewContext, input: ReviewInput) {
  const name = normalizeTemplateName(input.name);
  const category = requiredText(input.category, "Categoria", 30).toUpperCase();
  if (!new Set(["UTILITY", "MARKETING"]).has(category)) {
    throw new Error("Categoria inválida para este ambiente de teste");
  }
  const language = normalizeLanguage(input.language);
  const body = requiredText(input.body, "Texto do modelo", 1024);
  const parameterCount = bodyParameterCount(body);
  const examples = normalizeStringArray(input.examples, parameterCount, "Exemplos");
  const bodyComponent: Record<string, unknown> = { type: "BODY", text: body };
  if (parameterCount > 0) bodyComponent.example = { body_text: [examples] };

  const payload = {
    name,
    category,
    language,
    components: [bodyComponent],
  };
  const result = await graphRequest<{ id?: string; status?: string; category?: string }>(
    { graphVersion: context.graphVersion },
    `${context.connection.waba_id}/message_templates`,
    context.accessToken,
    { method: "POST", body: JSON.stringify(payload) },
  );
  await insertReviewEvent(context, {
    eventType: "template_created",
    eventKey: `template:${context.connection.waba_id}:${result.id ?? `${name}:${language}`}`,
    payload: { request: payload, response: result },
  });
  return jsonResponse({ ok: true, template: { ...result, name, language, category } });
}

async function sendTemplate(context: ReviewContext, input: ReviewInput) {
  const to = requiredText(input.to, "Destinatário", 30).replace(/\D/gu, "");
  if (!/^\d{8,15}$/u.test(to)) throw new Error("Informe o destinatário com DDI e DDD");
  const name = normalizeTemplateName(input.name);
  const language = normalizeLanguage(input.language);
  const templates = (await fetchTemplates(context)).data ?? [];
  const template = templates.find(
    (item) => item.name === name && item.language === language && item.status === "APPROVED",
  );
  if (!template) throw new Error("Selecione um modelo aprovado pela Meta");

  const body = template.components?.find((component) => component.type === "BODY");
  const parameterCount = bodyParameterCount(typeof body?.text === "string" ? body.text : "");
  const parameters = normalizeStringArray(input.parameters, parameterCount, "Parâmetros");
  const phone = context.phones[0];
  const components = parameterCount
    ? [
        {
          type: "body",
          parameters: parameters.map((text) => ({ type: "text", text })),
        },
      ]
    : undefined;
  const requestPayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name,
      language: { code: language },
      ...(components ? { components } : {}),
    },
  };
  const result = await graphRequest<{
    messaging_product?: string;
    contacts?: Array<{ input?: string; wa_id?: string }>;
    messages?: Array<{ id?: string; message_status?: string }>;
  }>(
    { graphVersion: context.graphVersion },
    `${phone.phone_number_id}/messages`,
    context.accessToken,
    { method: "POST", body: JSON.stringify(requestPayload) },
  );
  const messageId = result.messages?.[0]?.id;
  if (!messageId) throw new Error("A Meta não retornou o identificador da mensagem");
  const now = new Date().toISOString();
  const initialStatus = normalizeOutboundStatus(result.messages?.[0]?.message_status);
  const { error: messageError } = await context.admin.from("wa_messages").upsert(
    {
      phone_number_id: phone.phone_number_id,
      message_id: messageId,
      direction: "outbound",
      from_wa_id: phone.display_phone_number?.replace(/\D/gu, "") ?? phone.phone_number_id,
      to_wa_id: result.contacts?.[0]?.wa_id ?? to,
      type: "template",
      template_name: name,
      template_language: language,
      template_variables: parameters,
      timestamp_meta: now,
      status_current: initialStatus,
      status_last_at: now,
      tenant_id: context.connection.id_empresa,
      raw: { request: requestPayload, response: result },
      updated_at: now,
    },
    { onConflict: "phone_number_id,message_id" },
  );
  if (messageError) throw new Error(messageError.message);
  await insertReviewEvent(context, {
    eventType: "message_sent",
    eventKey: `send:${phone.phone_number_id}:${messageId}`,
    phoneNumberId: phone.phone_number_id,
    messageId,
    payload: { template: name, language, to, response: result },
    occurredAt: now,
  });
  return jsonResponse({ ok: true, messageId, status: initialStatus });
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const input = (await req.json()) as ReviewInput;
    const action = input.action ?? "get_state";
    const context = await getReviewContext(req, input.empresaId);
    if (action === "get_state") return getState(context);
    if (action === "create_template") return createTemplate(context, input);
    if (action === "send_template") return sendTemplate(context, input);
    throw new Error("Ação inválida");
  });
});
