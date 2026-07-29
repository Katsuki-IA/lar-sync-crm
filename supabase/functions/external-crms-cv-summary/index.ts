import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Json =
  | null
  | string
  | number
  | boolean
  | { [key: string]: Json }
  | Json[];

type LeadMessage = {
  id: string;
  type: string | null;
  message: Json | null;
  time: string | null;
  created_at: string | null;
};

type SummaryPayload = {
  leadId: number;
  idEmpresa: number;
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

async function authenticateRequest(
  supabaseAdmin: ReturnType<typeof createSupabaseAdmin>,
  req: Request,
  idEmpresa: number,
) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const apiKey = req.headers.get("apikey")?.trim() ?? "";
  const internalSecretHeader = req.headers.get("x-internal-secret")?.trim() ?? "";
  const internalSecret = Deno.env.get("EXTERNAL_CRMS_INTERNAL_SECRET")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";

  const isInternalRequest =
    (internalSecret && (internalSecretHeader === internalSecret || token === internalSecret)) ||
    (serviceRoleKey && (apiKey === serviceRoleKey || token === serviceRoleKey));

  if (isInternalRequest) {
    return;
  }

  if (!token) {
    throw new Error("Acesso interno inválido");
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
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
    throw new Error("Sem permissão para gerar resumo desta empresa");
  }
}

function onlyDigits(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function phoneVariants(value?: string | null) {
  const digits = onlyDigits(value);
  if (!digits) return [];

  const variants = new Set<string>([digits]);
  if (digits.length > 11) variants.add(digits.slice(-11));
  if (digits.startsWith("55") && digits.length > 2) variants.add(digits.slice(2));
  return Array.from(variants);
}

function sessionCandidates(args: { idEmpresa: number; phone?: string | null; externalPhone?: string | null }) {
  const numbers = [...phoneVariants(args.phone), ...phoneVariants(args.externalPhone)];
  return Array.from(
    new Set(
      numbers.map((number) => `${number}${args.idEmpresa}`),
    ),
  );
}

function messageToText(message: Json | null): string {
  if (message == null) return "";
  if (typeof message === "string") return message;
  if (typeof message === "number" || typeof message === "boolean") return String(message);
  if (Array.isArray(message)) {
    return message.map((item) => messageToText(item)).filter(Boolean).join("\n");
  }

  const record = message as Record<string, Json>;
  for (const key of ["content", "text", "message", "output", "body"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }

  try {
    return JSON.stringify(message);
  } catch {
    return "";
  }
}

function stripImageMarkers(text: string) {
  return text.replace(/\[IMG:[^\]]+\]/g, "").trim();
}

function sanitizeMessageText(text: string) {
  return stripImageMarkers(text)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseDateValue(value?: string | number | null) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const numeric = Number(raw);
  const date = Number.isFinite(numeric) && /^\d+$/.test(raw)
    ? new Date(raw.length <= 10 ? numeric * 1000 : numeric)
    : new Date(raw);

  return Number.isNaN(date.getTime()) ? null : date;
}

function sortTimestamp(message: LeadMessage) {
  return parseDateValue(message.time ?? message.created_at)?.getTime() ?? 0;
}

function isConversationMessageType(value: string | null): value is "human" | "ai" {
  return value === "human" || value === "ai";
}

function isTechnicalMessage(text: string) {
  const normalized = text.trim();
  if (/^Calling\s+\S+\s+with input:/i.test(normalized)) return true;
  if (!/^[{[]/.test(normalized)) return false;

  try {
    JSON.parse(normalized);
    return true;
  } catch {
    return false;
  }
}

function isSummaryConversationMessage(message: LeadMessage) {
  if (!isConversationMessageType(message.type)) return false;
  return !isTechnicalMessage(messageToText(message.message));
}

function currentConversationStart(value?: string | null) {
  const date = parseDateValue(value);
  if (!date) return null;

  // The first WhatsApp event can precede the CRM row by a few seconds.
  return new Date(date.getTime() - 2 * 60 * 1000).toISOString();
}

function activityToConversationMessages(activity: { id: number; descricao: string | null; created_at: string | null }) {
  const description = activity.descricao ?? "";
  if (!description.trim()) return [] as LeadMessage[];

  const markers = [
    "Mensagem recebida do lead:",
    "Resposta enviada pela IA:",
    "Mensagem enviada pela IA:",
    "Mensagem enviada ao lead:",
    "Mensagem enviada:",
  ];

  const extract = (marker: string) => {
    const start = description.indexOf(marker);
    if (start < 0) return null;

    let body = description.slice(start + marker.length);
    body = body.replace(/^\s*\n?-{3,}\n?/, "");

    const nextIndexes = markers
      .filter((candidate) => candidate !== marker)
      .map((candidate) => body.indexOf(candidate))
      .filter((index) => index >= 0);

    const end = nextIndexes.length ? Math.min(...nextIndexes) : body.length;
    const value = body.slice(0, end).replace(/-{3,}\s*$/, "").trim();
    return value || null;
  };

  const humanMessage = extract("Mensagem recebida do lead:");
  const aiMessage =
    extract("Resposta enviada pela IA:") ??
    extract("Mensagem enviada pela IA:") ??
    extract("Mensagem enviada ao lead:") ??
    extract("Mensagem enviada:");

  const messages: LeadMessage[] = [];
  if (humanMessage) {
    messages.push({
      id: `activity-${activity.id}-human`,
      type: "human",
      message: humanMessage,
      time: activity.created_at,
      created_at: activity.created_at,
    });
  }

  if (aiMessage) {
    messages.push({
      id: `activity-${activity.id}-ai`,
      type: "ai",
      message: aiMessage,
      time: activity.created_at,
      created_at: activity.created_at,
    });
  }

  return messages;
}

function buildTranscript(messages: LeadMessage[]) {
  return messages
    .map((message) => {
      if (!isSummaryConversationMessage(message)) return null;
      const speaker = message.type === "ai" ? "IA" : "Lead";
      const text = sanitizeMessageText(messageToText(message.message));
      if (!text) return null;
      return `${speaker}: ${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function inferTemperatureFallback(transcript: string) {
  const normalized = transcript.toLowerCase();
  const hotSignals = [
    "valor",
    "preço",
    "preco",
    "pagamento",
    "parcel",
    "entrada",
    "metragem",
    "m²",
    "metros",
    "localização",
    "localizacao",
    "bairro",
    "visita",
    "quartos",
    "suíte",
    "suite",
  ];

  if (hotSignals.some((signal) => normalized.includes(signal))) return "QUENTE";
  return "FRIO";
}

function buildWhatsAppUrl(phone?: string | null, empreendimento?: string | null) {
  const digits = onlyDigits(phone);
  if (!digits) return null;

  const text = empreendimento
    ? `Posso te ajudar com mais informacoes sobre ${stripDiacritics(empreendimento)}?`
    : "Posso te ajudar com mais informacoes?";

  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function buildFallbackSummary(args: {
  transcript: string;
  empreendimentoNomes: string[];
  conversationUrl: string;
  whatsappUrl: string | null;
}) {
  const transcriptLines = args.transcript
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const summaryBase = transcriptLines.slice(0, 4).join(" ").slice(0, 420) || "Conversa sem conteúdo suficiente para resumo automático.";
  const projects = args.empreendimentoNomes.length ? args.empreendimentoNomes : ["Não identificado"];
  const temperature = inferTemperatureFallback(args.transcript);

  return [
    `Resumo da conversa: ${summaryBase}`,
    `Temperatura: ${temperature}`,
    "Imóveis que o cliente se interessou:",
    ...projects.map((name, index) => `${index + 1}. ${name}`),
    "",
    `Você pode ler a conversa completa através do link:\n${args.conversationUrl}`,
    `Você pode atender o usuário através do link:\n${args.whatsappUrl ?? "Não disponível"}`,
  ].join("\n");
}

async function buildDeepSeekSummary(args: {
  transcript: string;
  empreendimentoNomes: string[];
  conversationUrl: string;
  whatsappUrl: string | null;
}) {
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY")?.trim() ?? "";
  const baseUrl = Deno.env.get("DEEPSEEK_BASE_URL")?.trim() || "https://api.deepseek.com";
  const model = Deno.env.get("DEEPSEEK_MODEL")?.trim() || "deepseek-v4-flash";

  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY não configurada");
  }

  const empreendimentoContext = args.empreendimentoNomes.length
    ? args.empreendimentoNomes.join(", ")
    : "Nenhum empreendimento identificado previamente";

  const systemPrompt = [
    "Você resume conversas de leads imobiliários para um corretor humano.",
    "Classifique a temperatura somente como QUENTE ou FRIO.",
    "Considere QUENTE quando o lead perguntar ou demonstrar interesse em valores, formas de pagamento, parcelamento, localização, metragens, detalhes do imóvel ou visita.",
    "Pouca interação ou respostas vagas tendem a ser FRIO.",
    "Use mensagens da IA somente como contexto.",
    "Em empreendimentos, inclua somente o que o Lead selecionar, mencionar como interesse ou perguntar sobre no contexto imediato.",
    "Nunca inclua um empreendimento citado apenas pela IA, por instruções ou pelo contexto de empreendimentos já identificados.",
    "Responda somente em JSON válido com as chaves: resumo, temperatura, empreendimentos.",
    "empreendimentos deve ser um array de strings sem duplicidade.",
  ].join(" ");

  const userPrompt = [
    `Empreendimentos já identificados: ${empreendimentoContext}.`,
    "Gere um resumo curto e objetivo da conversa, em português do Brasil.",
    "Conversa:",
    args.transcript,
  ].join("\n\n");

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? payload?.message ?? `DeepSeek retornou ${response.status}`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("DeepSeek não retornou conteúdo");
  }

  const parsed = JSON.parse(content);
  const resumo = typeof parsed?.resumo === "string" ? parsed.resumo.trim() : "";
  const temperaturaRaw = typeof parsed?.temperatura === "string" ? parsed.temperatura.trim().toUpperCase() : "";
  const temperatura = temperaturaRaw === "QUENTE" ? "QUENTE" : "FRIO";
  const empreendimentos = Array.isArray(parsed?.empreendimentos)
    ? parsed.empreendimentos
        .map((item: unknown) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];

  const projects = empreendimentos.length
    ? Array.from(new Set(empreendimentos))
    : (args.empreendimentoNomes.length ? args.empreendimentoNomes : ["Não identificado"]);

  return [
    `Resumo da conversa: ${resumo || "Conversa sem conteúdo suficiente para resumo automático."}`,
    `Temperatura: ${temperatura}`,
    "Imóveis que o cliente se interessou:",
    ...projects.map((name, index) => `${index + 1}. ${name}`),
    "",
    `Você pode ler a conversa completa através do link:\n${args.conversationUrl}`,
    `Você pode atender o usuário através do link:\n${args.whatsappUrl ?? "Não disponível"}`,
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Método não permitido" }, 405);
    }

    const body = (await req.json()) as Partial<SummaryPayload>;
    const leadId = Number(body.leadId);
    const idEmpresa = Number(body.idEmpresa);

    if (!Number.isFinite(leadId) || !Number.isFinite(idEmpresa)) {
      throw new Error("leadId e idEmpresa são obrigatórios");
    }

    const supabaseAdmin = createSupabaseAdmin();
    await authenticateRequest(supabaseAdmin, req, idEmpresa);

    const { data: lead, error: leadError } = await supabaseAdmin
      .from("crm_leads")
      .select("id,id_empresa,nome,telefone,email,origem,id_empreendimento,created_at,historico_token")
      .eq("id", leadId)
      .eq("id_empresa", idEmpresa)
      .maybeSingle();
    if (leadError) throw new Error(leadError.message);
    if (!lead) throw new Error("Lead não encontrado");

    const [{ data: empresa, error: empresaError }, { data: leadRows, error: externalLeadError }] = await Promise.all([
      supabaseAdmin
        .from("empresa_dados")
        .select("id,nome")
        .eq("id", idEmpresa)
        .maybeSingle(),
      supabaseAdmin
        .from("lead")
        .select("id,id_empresa,numero,id_crm,empreendimento_em_foco_id,updated_at,created_at")
        .eq("id_empresa", idEmpresa)
        .eq("id_crm", String(lead.id))
        .order("updated_at", { ascending: false })
        .limit(1),
    ]);
    if (empresaError) throw new Error(empresaError.message);
    if (externalLeadError) throw new Error(externalLeadError.message);

    const externalLead = leadRows?.[0] ?? null;

    const empreendimentoIds = Array.from(new Set([
      lead.id_empreendimento,
      externalLead?.empreendimento_em_foco_id ?? null,
    ].filter((value): value is number => value != null)));

    const { data: empreendimentos, error: empreendimentosError } = empreendimentoIds.length
      ? await supabaseAdmin
          .from("empreendimento")
          .select("id,nome")
          .eq("id_empresa", idEmpresa)
          .in("id", empreendimentoIds)
      : { data: [], error: null };
    if (empreendimentosError) throw new Error(empreendimentosError.message);

    const empreendimentoNomes = Array.from(
      new Set((empreendimentos ?? []).map((item: { nome: string | null }) => item.nome?.trim()).filter(Boolean) as string[]),
    );

    const candidates = sessionCandidates({
      idEmpresa,
      phone: lead.telefone,
      externalPhone: externalLead?.numero ?? null,
    });
    const conversationStart = currentConversationStart(externalLead?.created_at ?? lead.created_at);

    let messages: LeadMessage[] = [];
    if (candidates.length) {
      const chatQuery = supabaseAdmin
        .from("n8n_chat_conversas")
        .select("id,numero,type,message,time,created_at")
        .in("numero", candidates)
        .in("type", ["human", "ai"])
        .order("time", { ascending: true });

      const { data: chatRows, error: chatError } = await (conversationStart
        ? chatQuery.gte("time", conversationStart)
        : chatQuery);
      if (chatError) throw new Error(chatError.message);

      messages = (chatRows ?? [])
        .filter((message: { type: string | null }) => isConversationMessageType(message.type))
        .map((message: {
          id: number | string;
          type: "human" | "ai";
          message: Json | null;
          time: string | null;
          created_at: string | null;
        }) => ({
          id: `chat-${message.id}`,
          type: message.type,
          message: message.message,
          time: message.time,
          created_at: message.created_at,
        }))
        .filter(isSummaryConversationMessage);
    }

    if (!messages.length) {
      const { data: activities, error: activitiesError } = await supabaseAdmin
        .from("crm_lead_activities")
        .select("id,descricao,created_at")
        .eq("lead_id", lead.id)
        .eq("tipo", "whatsapp_automation")
        .order("created_at", { ascending: true });
      if (activitiesError) throw new Error(activitiesError.message);
      messages = (activities ?? []).flatMap(activityToConversationMessages);
    }

    messages = [...messages].sort((a, b) => sortTimestamp(a) - sortTimestamp(b));

    const transcript = buildTranscript(messages);
    const appBaseUrl = (Deno.env.get("APP_BASE_URL")?.trim() || "https://hub.katsuki.com.br").replace(/\/+$/, "");
    const conversationUrl = `${appBaseUrl}/historico/${lead.historico_token ?? lead.id}`;
    const whatsappUrl = buildWhatsAppUrl(lead.telefone, empreendimentoNomes[0] ?? null);

    if (!transcript) {
      const fallback = buildFallbackSummary({
        transcript: "Conversa indisponível.",
        empreendimentoNomes,
        conversationUrl,
        whatsappUrl,
      });

      return jsonResponse({
        ok: true,
        summary: fallback,
        used_fallback: true,
        messages_count: 0,
      });
    }

    let summaryText = "";
    let usedFallback = false;

    try {
      summaryText = await buildDeepSeekSummary({
        transcript,
        empreendimentoNomes,
        conversationUrl,
        whatsappUrl,
      });
    } catch (error) {
      console.error("Falha ao resumir conversa com DeepSeek", error);
      summaryText = buildFallbackSummary({
        transcript,
        empreendimentoNomes,
        conversationUrl,
        whatsappUrl,
      });
      usedFallback = true;
    }

    return jsonResponse({
      ok: true,
      lead_id: lead.id,
      empresa_nome: empresa?.nome ?? null,
      summary: summaryText,
      used_fallback: usedFallback,
      messages_count: messages.length,
      conversation_url: conversationUrl,
      whatsapp_url: whatsappUrl,
    });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro interno" },
      400,
    );
  }
});
