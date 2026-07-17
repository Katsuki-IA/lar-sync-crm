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

type ClassifyPayload = {
  idEmpresa?: number | string;
  empreendimentoId?: number | string | null;
  typeFilter?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number | string | null;
  force?: boolean | null;
};

type LeadRow = {
  id: number;
  id_empresa: number;
  id_empreendimento: number | null;
  empreendimento_em_foco_id: number | null;
  empreendimento_em_foco_nome: string | null;
  nome: string | null;
  numero: string | null;
  qtd_interacoes: number | null;
  qualificado: number | null;
  status_history: string | null;
  ativacao: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  last_message_timestamp: string | null;
};

type ChatRow = {
  id: number | string;
  numero: string | null;
  type: string | null;
  message: Json | null;
  time: string | null;
  created_at: string | null;
};

type Classification = {
  cliente_respondeu: boolean;
  nao_respondeu_mais: boolean;
  lead_desqualificado: boolean;
  qualificado: boolean;
  visita_agendada: boolean;
  temperatura: "frio" | "morno" | "quente";
  resumo: string;
  motivos: string[];
};

const TYPE_ALL = "all";
const TYPE_INBOUND = "inbound";
const TYPE_ACTIVATION = "activation";

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

  if (isInternalRequest) return;

  if (!token) {
    throw new Error("Sessão inválida");
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData.user) {
    throw new Error("Sessão inválida");
  }

  const { data: crmUser, error: crmUserError } = await supabaseAdmin
    .from("crm_users")
    .select("id,id_empresa,role")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();

  if (crmUserError || !crmUser) {
    throw new Error("Usuário do CRM não encontrado");
  }

  const isManager = ["manager", "gestor"].includes(String(crmUser.role));
  if (crmUser.role !== "super_admin" && !(isManager && crmUser.id_empresa === idEmpresa)) {
    throw new Error("Sem permissão para classificar conversas desta empresa");
  }
}

function onlyDigits(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

function phoneVariants(value?: string | null) {
  const digits = onlyDigits(value);
  if (!digits) return [];

  const variants = new Set<string>([digits]);
  if (digits.length > 11) variants.add(digits.slice(-11));
  if (digits.startsWith("55") && digits.length > 2) variants.add(digits.slice(2));
  return Array.from(variants);
}

function sessionCandidates(lead: LeadRow) {
  return phoneVariants(lead.numero).map((phone) => `${phone}${lead.id_empresa}`);
}

function messageToText(message: Json | null): string {
  if (message == null) return "";
  if (typeof message === "string") return message;
  if (typeof message === "number" || typeof message === "boolean") return String(message);
  if (Array.isArray(message)) return message.map((item) => messageToText(item)).filter(Boolean).join("\n");

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

function withinDateRange(value: string | null, from?: string | null, to?: string | null) {
  const date = parseDateValue(value);
  if (!date) return false;
  const start = from ? new Date(`${from}T00:00:00`) : null;
  const end = to ? new Date(`${to}T23:59:59.999`) : null;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function historyIncludes(lead: LeadRow, term: string) {
  return (lead.status_history ?? "").toLowerCase().includes(term.toLowerCase());
}

function sortTimestamp(message: ChatRow) {
  return parseDateValue(message.time ?? message.created_at)?.getTime() ?? 0;
}

function buildTranscript(messages: ChatRow[]) {
  return messages
    .map((message) => {
      const speaker = message.type === "ai" ? "IA" : "Lead";
      const text = messageToText(message.message)
        .replace(/\[IMG:\s*[^\]]+\]/g, "[imagem enviada]")
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (!text) return null;
      return `${speaker}: ${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function parseJsonObject(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Resposta da IA não veio em JSON válido");
    return JSON.parse(match[0]);
  }
}

function normalizeClassification(raw: Record<string, unknown>): Classification {
  const temperature = String(raw.temperatura ?? "frio").toLowerCase();
  const motivos = Array.isArray(raw.motivos)
    ? raw.motivos.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
    : [];

  return {
    cliente_respondeu: Boolean(raw.cliente_respondeu),
    nao_respondeu_mais: Boolean(raw.nao_respondeu_mais),
    lead_desqualificado: Boolean(raw.lead_desqualificado),
    qualificado: Boolean(raw.qualificado),
    visita_agendada: Boolean(raw.visita_agendada),
    temperatura: temperature === "quente" || temperature === "morno" ? temperature : "frio",
    resumo: typeof raw.resumo === "string" ? raw.resumo.trim().slice(0, 1200) : "",
    motivos,
  };
}

function fallbackClassification(args: {
  lead: LeadRow;
  messages: ChatRow[];
  hasAppointment: boolean;
  transcript: string;
}): Classification {
  const interactionCount = Math.max(args.lead.qtd_interacoes ?? 0, 0);
  const humanCount = args.messages.filter((message) => message.type === "human").length;
  const normalized = `${args.transcript}\n${args.lead.status_history ?? ""}`.toLowerCase();
  const hotSignals = [
    "valor",
    "preço",
    "preco",
    "pagamento",
    "parcel",
    "entrada",
    "metragem",
    "localização",
    "localizacao",
    "bairro",
    "visita",
    "quartos",
    "suíte",
    "suite",
  ];
  const disqualifiedSignals = ["sem interesse", "não tenho interesse", "nao tenho interesse", "perdido", "desqualificado", "sem whatsapp"];
  const clienteRespondeu = humanCount > 0 || interactionCount >= 2;
  const leadDesqualificado = disqualifiedSignals.some((signal) => normalized.includes(signal));
  const visitaAgendada = args.hasAppointment || historyIncludes(args.lead, "Visita Agendada");
  const qualificado =
    visitaAgendada ||
    args.lead.qualificado === 1 ||
    (hotSignals.some((signal) => normalized.includes(signal)) && !leadDesqualificado);

  return {
    cliente_respondeu: clienteRespondeu,
    nao_respondeu_mais: !clienteRespondeu || normalized.includes("não respondeu") || normalized.includes("nao respondeu"),
    lead_desqualificado: leadDesqualificado,
    qualificado,
    visita_agendada: visitaAgendada,
    temperatura: qualificado ? "quente" : clienteRespondeu ? "morno" : "frio",
    resumo: args.transcript
      ? args.transcript.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 5).join(" ").slice(0, 700)
      : "Conversa sem mensagens suficientes para classificação detalhada.",
    motivos: ["Classificação gerada por regras locais"],
  };
}

async function classifyWithDeepSeek(args: {
  transcript: string;
  lead: LeadRow;
  empreendimentoName: string | null;
}) {
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY")?.trim() ?? "";
  const baseUrl = Deno.env.get("DEEPSEEK_BASE_URL")?.trim() || "https://api.deepseek.com";
  const model = Deno.env.get("DEEPSEEK_MODEL")?.trim() || "deepseek-v4-flash";

  if (!apiKey) throw new Error("DEEPSEEK_API_KEY não configurada");

  const systemPrompt = [
    "Você classifica conversas de leads imobiliários para um dashboard de CRM.",
    "Responda somente JSON válido.",
    "Campos obrigatórios: cliente_respondeu, nao_respondeu_mais, lead_desqualificado, qualificado, visita_agendada, temperatura, resumo, motivos.",
    "temperatura deve ser frio, morno ou quente.",
    "Considere quente quando houver interesse em valores, pagamento, parcelamento, localização, metragem, quartos, lazer, unidade ou visita.",
    "Pouca interação ou nenhum retorno do lead tende a ser frio.",
    "Lead desqualificado quando não tem interesse, número inválido, sem WhatsApp, perfil incompatível ou pediu para parar.",
  ].join(" ");

  const userPrompt = [
    `Lead: ${args.lead.nome ?? "Sem nome"}`,
    `Empreendimento: ${args.empreendimentoName ?? "Não identificado"}`,
    `Interações registradas: ${args.lead.qtd_interacoes ?? 0}`,
    "Conversa:",
    args.transcript || "Sem mensagens na conversa.",
  ].join("\n\n");

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
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

  return {
    classification: normalizeClassification(parseJsonObject(content)),
    rawResponse: payload,
    model,
  };
}

function applyDeterministicOverrides(args: {
  classification: Classification;
  lead: LeadRow;
  hasAppointment: boolean;
  messages: ChatRow[];
}) {
  const interactionCount = Math.max(args.lead.qtd_interacoes ?? 0, 0);
  const humanCount = args.messages.filter((message) => message.type === "human").length;
  const classification = { ...args.classification };

  if (humanCount > 0 || interactionCount >= 2) classification.cliente_respondeu = true;
  if (!classification.cliente_respondeu) classification.nao_respondeu_mais = true;
  if (args.hasAppointment || historyIncludes(args.lead, "Visita Agendada")) {
    classification.visita_agendada = true;
    classification.qualificado = true;
    classification.cliente_respondeu = true;
  }
  if (args.lead.qualificado === 1 || historyIncludes(args.lead, "Qualificado")) {
    classification.qualificado = true;
  }
  if (historyIncludes(args.lead, "Desqualificado") || historyIncludes(args.lead, "Perdido")) {
    classification.lead_desqualificado = true;
  }
  if (classification.qualificado || classification.visita_agendada) {
    classification.temperatura = "quente";
  }

  return classification;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Método não permitido" }, 405);
    }

    const body = (await req.json()) as ClassifyPayload;
    const idEmpresa = Number(body.idEmpresa);
    const empreendimentoId = body.empreendimentoId == null || body.empreendimentoId === ""
      ? null
      : Number(body.empreendimentoId);
    const limit = Math.min(Math.max(Number(body.limit ?? 30) || 30, 1), 30);
    const typeFilter = body.typeFilter ?? TYPE_ALL;
    const force = Boolean(body.force);

    if (!Number.isFinite(idEmpresa)) {
      throw new Error("idEmpresa é obrigatório");
    }
    if (empreendimentoId != null && !Number.isFinite(empreendimentoId)) {
      throw new Error("empreendimentoId inválido");
    }

    const supabaseAdmin = createSupabaseAdmin();
    await authenticateRequest(supabaseAdmin, req, idEmpresa);

    let leadQuery = supabaseAdmin
      .from("lead")
      .select(
        "id,id_empresa,id_empreendimento,empreendimento_em_foco_id,empreendimento_em_foco_nome,nome,numero,qtd_interacoes,qualificado,status_history,ativacao,created_at,updated_at,last_message_timestamp",
      )
      .eq("id_empresa", idEmpresa)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1000);

    if (empreendimentoId != null) {
      leadQuery = leadQuery.or(`id_empreendimento.eq.${empreendimentoId},empreendimento_em_foco_id.eq.${empreendimentoId}`);
    }
    if (typeFilter === TYPE_INBOUND) leadQuery = leadQuery.eq("ativacao", false);
    if (typeFilter === TYPE_ACTIVATION) leadQuery = leadQuery.eq("ativacao", true);

    const { data: leadRows, error: leadError } = await leadQuery;
    if (leadError) throw new Error(leadError.message);

    const leads = (leadRows ?? []) as LeadRow[];
    const leadIds = leads.map((lead) => lead.id);
    const sessionToLeadId = new Map<string, number>();
    for (const lead of leads) {
      for (const sessionId of sessionCandidates(lead)) {
        sessionToLeadId.set(sessionId, lead.id);
      }
    }

    const sessionIds = Array.from(sessionToLeadId.keys());
    const { data: messageRows, error: messageError } = sessionIds.length
      ? await supabaseAdmin
          .from("n8n_chat_conversas")
          .select("id,numero,type,message,time,created_at")
          .in("numero", sessionIds)
          .order("time", { ascending: true })
      : { data: [], error: null };
    if (messageError) throw new Error(messageError.message);

    const messagesByLead = new Map<number, ChatRow[]>();
    for (const message of (messageRows ?? []) as ChatRow[]) {
      if (!message.numero) continue;
      const leadId = sessionToLeadId.get(message.numero);
      if (!leadId) continue;
      const group = messagesByLead.get(leadId) ?? [];
      group.push(message);
      messagesByLead.set(leadId, group);
    }

    const { data: existingRows, error: existingError } = leadIds.length
      ? await supabaseAdmin
          .from("crm_conversation_classifications")
          .select("lead_id")
          .eq("id_empresa", idEmpresa)
          .in("lead_id", leadIds)
      : { data: [], error: null };
    if (existingError) throw new Error(existingError.message);
    const existingLeadIds = new Set((existingRows ?? []).map((row: { lead_id: number }) => row.lead_id));

    const { data: appointments, error: appointmentsError } = leadIds.length
      ? await supabaseAdmin
          .from("agendamento")
          .select("id_lead")
          .eq("id_empresa", idEmpresa)
          .is("deleted_at", null)
          .in("id_lead", leadIds)
      : { data: [], error: null };
    if (appointmentsError) throw new Error(appointmentsError.message);
    const scheduledLeadIds = new Set((appointments ?? []).map((row: { id_lead: number | null }) => row.id_lead).filter(Boolean));

    const empreendimentoIds = Array.from(new Set(
      leads
        .flatMap((lead) => [lead.id_empreendimento, lead.empreendimento_em_foco_id])
        .filter((value): value is number => value != null),
    ));
    const { data: empreendimentos, error: empreendimentosError } = empreendimentoIds.length
      ? await supabaseAdmin
          .from("empreendimento")
          .select("id,nome")
          .eq("id_empresa", idEmpresa)
          .in("id", empreendimentoIds)
      : { data: [], error: null };
    if (empreendimentosError) throw new Error(empreendimentosError.message);
    const empreendimentoNameById = new Map((empreendimentos ?? []).map((item: { id: number; nome: string | null }) => [item.id, item.nome]));

    const candidates = leads
      .map((lead) => {
        const messages = [...(messagesByLead.get(lead.id) ?? [])].sort((a, b) => sortTimestamp(a) - sortTimestamp(b));
        const lastMessage = messages.at(-1);
        const lastAt = lastMessage?.time ?? lastMessage?.created_at ?? lead.last_message_timestamp ?? lead.updated_at ?? lead.created_at;
        return { lead, messages, lastAt };
      })
      .filter((item) => withinDateRange(item.lastAt, body.dateFrom, body.dateTo))
      .filter((item) => force || !existingLeadIds.has(item.lead.id))
      .sort((a, b) => (parseDateValue(b.lastAt)?.getTime() ?? 0) - (parseDateValue(a.lastAt)?.getTime() ?? 0))
      .slice(0, limit);

    const rowsToUpsert = [];
    const errors: string[] = [];

    for (const candidate of candidates) {
      const { lead, messages } = candidate;
      const transcript = buildTranscript(messages);
      const empreendimentoName =
        (lead.id_empreendimento ? empreendimentoNameById.get(lead.id_empreendimento) : null) ??
        (lead.empreendimento_em_foco_id ? empreendimentoNameById.get(lead.empreendimento_em_foco_id) : null) ??
        lead.empreendimento_em_foco_nome ??
        null;

      let rawResponse: unknown = null;
      let model: string | null = null;
      let classification = fallbackClassification({
        lead,
        messages,
        hasAppointment: scheduledLeadIds.has(lead.id),
        transcript,
      });

      if (transcript) {
        try {
          const ai = await classifyWithDeepSeek({ transcript, lead, empreendimentoName });
          classification = ai.classification;
          rawResponse = ai.rawResponse;
          model = ai.model;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("Falha ao classificar conversa com DeepSeek", { leadId: lead.id, message });
          errors.push(`#${lead.id}: ${message}`);
        }
      }

      classification = applyDeterministicOverrides({
        classification,
        lead,
        hasAppointment: scheduledLeadIds.has(lead.id),
        messages,
      });

      rowsToUpsert.push({
        id_empresa: idEmpresa,
        lead_id: lead.id,
        id_empreendimento: lead.id_empreendimento ?? lead.empreendimento_em_foco_id,
        cliente_respondeu: classification.cliente_respondeu,
        nao_respondeu_mais: classification.nao_respondeu_mais,
        lead_desqualificado: classification.lead_desqualificado,
        qualificado: classification.qualificado,
        visita_agendada: classification.visita_agendada,
        temperatura: classification.temperatura,
        resumo: classification.resumo,
        motivos: classification.motivos,
        message_count: messages.length || Math.max(lead.qtd_interacoes ?? 0, 0),
        human_count: messages.filter((message) => message.type === "human").length,
        ai_count: messages.filter((message) => message.type === "ai").length,
        model,
        raw_response: rawResponse as Json,
        classified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    if (rowsToUpsert.length) {
      const { error: upsertError } = await supabaseAdmin
        .from("crm_conversation_classifications")
        .upsert(rowsToUpsert, { onConflict: "id_empresa,lead_id" });
      if (upsertError) throw new Error(upsertError.message);
    }

    return jsonResponse({
      ok: true,
      processed: candidates.length,
      classified: rowsToUpsert.length,
      skipped: Math.max(leads.length - candidates.length, 0),
      errors: errors.slice(0, 8),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao classificar conversas";
    console.error("Falha ao classificar conversas", error);
    return jsonResponse({ error: message }, 400);
  }
});
