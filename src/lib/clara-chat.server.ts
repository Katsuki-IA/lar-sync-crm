// Geração da Clara no servidor. Credenciais só no servidor; modelo fixo pela
// config (gpt-4.1 / 0.5). Transporte: OpenAI direto (OPENAI_API_KEY) ou ponte n8n.
import {
  buildSystemPrompt, CLARA_EMPRESA_ID, CLARA_GREETING, contactFromUserMessages, INFERENCE_DEADLINE_MS, parseContact,
} from "./clara-chat";
import { nowInTZ, parseDataRawToYMD, resolveScheduleRequest, type Turn } from "./clara-schedule-guard.server";
import { webBookingAccepted, webCancellationRequested, webStageNote } from "./clara-web-stage";

export const CLARA_TZ = "America/Sao_Paulo";
export type HistoryMsg = { role: "user" | "assistant"; content: string; created_at?: string };

/** Data/hora reais do servidor no fuso da Clara, injetadas a cada turno. */
export function currentTimeNote(clock: Date = new Date()): string {
  const f = new Intl.DateTimeFormat("pt-BR", { timeZone: CLARA_TZ, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return `Data e hora atuais (${CLARA_TZ}): ${f.format(clock)}.`;
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

type Msg = { role: "user" | "assistant"; content: string };
type Admin = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

export class ClaraNotConfiguredError extends Error {}

export async function loadSystemPrompt(admin: Pick<Admin, "from">, promptIds: number[]) {
  const [{ data: prompts, error: e1 }, { data: kb, error: e2 }] = await Promise.all([
    admin.from("prompt_especifico").select("id,node,prompt").eq("id_empresa", CLARA_EMPRESA_ID).in("id", promptIds),
    admin.from("empresa_conhecimento").select("titulo,categoria,conteudo,ordem").eq("id_empresa", CLARA_EMPRESA_ID),
  ]);
  if (e1 || e2) throw new Error("prompt_load_failed");
  return buildSystemPrompt(promptIds, prompts ?? [], kb ?? []);
}

const nullable = (type: string) => ({ type: [type, "null"] });
const fn = (name: string, description: string, properties: Record<string, unknown>) => ({
  type: "function",
  function: {
    name, description, strict: true,
    parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
  },
});
export const TOOLS = [
  fn("registrar_contato", "Registra nome, e-mail e/ou telefone que o próprio visitante escreveu nesta conversa. Nunca invente dados.",
    { nome: { type: "string" }, email: nullable("string"), telefone: nullable("string") }),
  fn("consultar_horarios", "Consulta horários livres de reunião online (exige contato registrado com telefone).",
    { dia: { ...nullable("string"), description: "AAAA-MM-DD ou null" }, periodo: { type: ["string", "null"], enum: ["manha", "tarde", null] } }),
  fn("agendar_reuniao", "Agenda, reagenda ou cancela a reunião online do visitante.",
    {
      acao: { type: "string", enum: ["agendar", "reagendar", "cancelar"] },
      dia: { ...nullable("string"), description: "AAAA-MM-DD" },
      hora: { ...nullable("string"), description: "HH:MM" },
      reserva_id: nullable("integer"), revisao: nullable("integer"),
    }),
];

/** Corpo Chat Completions -> JSON de resposta Chat Completions. */
export type CompletionTransport = (body: Record<string, unknown>, signal: AbortSignal) => Promise<any>;

function openAiDirectTransport(apiKey: string): CompletionTransport {
  return async (body, signal) => {
    const res = await fetch(OPENAI_URL, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...body, max_tokens: 1800, stream: false }),
    });
    if (!res.ok) throw new Error(`openai_${res.status}`);
    return res.json();
  };
}

export const BRIDGE_URL = "https://n8n2.katsuki.com.br/webhook/clara-web-inference-v1";

/** Ponte n8n: job via RPC service_role; só {job_id, token} vai ao webhook. */
export function n8nBridgeTransport(admin: Pick<Admin, "rpc">, fetchImpl: typeof fetch = fetch): CompletionTransport {
  return async (body, signal) => {
    const payload = { ...body, model: "gpt-4.1", temperature: 0.5, max_tokens: 1800, stream: false };
    const { data, error } = await admin.rpc("clara_web_inference_create", { p_payload: payload });
    const job = Array.isArray(data) ? data[0] : data;
    if (error || !job?.job_id || !job?.token) throw new ClaraNotConfiguredError();
    const res = await fetchImpl(BRIDGE_URL, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: job.job_id, token: job.token }),
    });
    if (!res.ok) throw new Error(`bridge_${res.status}`);
    const out = await res.json();
    if (!Array.isArray(out?.choices)) throw new Error("bridge_invalid_response");
    return out;
  };
}

export function resolveCompletionTransport(admin?: Pick<Admin, "rpc">): CompletionTransport | null {
  const apiKey = String(process.env["OPENAI_API_KEY"] ?? "").trim();
  if (apiKey) return openAiDirectTransport(apiKey);
  return admin ? n8nBridgeTransport(admin) : null;
}

/** Executa ferramentas; cada uma revalida o lease no banco. */
export type ToolRunner = (name: string, args: any) => Promise<unknown>;

export function createToolRunner(opts: {
  admin: Pick<Admin, "rpc">; tokenHash: string; requestId: string; leaseToken: string; userTexts: string[];
  history?: HistoryMsg[]; leadId?: number | null; clock?: () => Date;
}): ToolRunner {
  // ID do lead vinculado à sessão: vem do begin/save_contact, só no servidor, nunca do modelo.
  let leadId = Number.isSafeInteger(Number(opts.leadId)) && Number(opts.leadId) > 0 ? Number(opts.leadId) : null;
  const clock = () => opts.clock?.() ?? new Date();
  const history = opts.history ?? [];
  const turns: Turn[] = history.filter((m) => m.content && m.created_at)
    .map((m) => ({ type: m.role === "user" ? "human" : "ai", text: m.content, at: String(m.created_at) }));
  const lastMsg = history.at(-1);
  const current = lastMsg?.role === "user" ? lastMsg.content : "";
  const base = { p_empresa: CLARA_EMPRESA_ID, p_token_hash: opts.tokenHash, p_request: opts.requestId, p_lease: opts.leaseToken };
  const call = async (fnName: string, args: Record<string, unknown>) => {
    const { data, error } = await opts.admin.rpc(fnName, { ...base, ...args });
    if (error) return { outcome: "error" };
    return data;
  };
  return async (name, args) => {
    if (name === "registrar_contato") {
      const parsed = parseContact(args ?? {});
      const c = parsed && contactFromUserMessages(parsed, opts.userTexts);
      if (!c) return { outcome: "invalid", motivo: "use apenas dados escritos pelo visitante (nome e e-mail ou telefone)" };
      const saved: any = await call("web_chat_save_contact", { p_nome: c.nome, p_email: c.email, p_telefone: c.telefone });
      if (saved && typeof saved === "object") {
        if (Number(saved.lead_id) > 0) leadId = Number(saved.lead_id);
        const { lead_id: _omit, ...rest } = saved;
        return rest;
      }
      return saved;
    }
    if (name === "consultar_horarios") {
      if (!webBookingAccepted(history)) return { outcome: "meeting_consent_required", reason: "Continue a descoberta/demonstração. Dados de contato não autorizam agenda." };
      // Consulta pode normalizar a data do modelo; nada é reservado aqui.
      const raw = typeof args?.dia === "string" ? args.dia : null;
      const day = raw ? (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : parseDataRawToYMD(raw, nowInTZ(CLARA_TZ, clock()))) : null;
      const period = args?.periodo === "manha" || args?.periodo === "tarde" ? args.periodo : null;
      return call("web_chat_schedule", { p_op: "opcoes", p_day: day, p_time: null, p_period: period, p_booking: null, p_revision: null });
    }
    if (name === "agendar_reuniao" && ["agendar", "reagendar", "cancelar"].includes(args?.acao)) {
      if (args.acao !== "cancelar" && !webBookingAccepted(history)) return { outcome: "meeting_consent_required" };
      if (!leadId) return { outcome: "contact_required" };
      // Reserva/cancelamento exigem evidência nas mensagens; valores do guard vencem os do modelo.
      const g = resolveScheduleRequest({
        empresa: CLARA_EMPRESA_ID, lead_id: leadId, acao: args.acao,
        data_raw: typeof args?.dia === "string" ? args.dia : "", hora_raw: typeof args?.hora === "string" ? args.hora : "",
        booking: Number.isInteger(args?.reserva_id) ? args.reserva_id : 0, revision: Number.isInteger(args?.revisao) ? args.revisao : 0,
        request: opts.requestId, mensagem_atual: current,
      }, { recent_turns: turns, server_now: clock().toISOString(), booking_rules: { tz: CLARA_TZ, slot_minutes: 60 } });
      if (!g.valid) return { outcome: g.outcome, reason: g.reason, customer_message: g.customer_message };
      return call("web_chat_schedule", {
        p_op: g.acao, p_day: g.dia || null, p_time: g.hora || null, p_period: null,
        p_booking: g.booking > 0 ? g.booking : null, p_revision: g.revision > 0 ? g.revision : null,
      });
    }
    return { outcome: "invalid" };
  };
}

export async function generateClaraReply(opts: {
  system: string; history: Msg[]; greeting: boolean; model: string; temperature: number;
  transport: CompletionTransport; runTool: ToolRunner; deadlineMs?: number; clock?: Date;
}): Promise<{ text: string }> {
  // A abertura é persistida pelo mesmo finish/lease das demais respostas, sem inferência.
  if (opts.greeting) return { text: CLARA_GREETING };
  // Prazo total de inferência (todos os passos) — menor que o lease de 120s.
  const signal = AbortSignal.timeout(opts.deadlineMs ?? INFERENCE_DEADLINE_MS);
  const messages: any[] = [{ role: "system", content: opts.system },
    ...opts.history.map(({ role, content }) => ({ role, content })),
    { role: "system", content: currentTimeNote(opts.clock ?? new Date()) + "\n" + webStageNote(opts.history) }];
  for (let step = 0; step < 4; step++) {
    const allowedTools = webBookingAccepted(opts.history) ? TOOLS : TOOLS.filter((t) => t.function.name === "registrar_contato"
      || (t.function.name === "agendar_reuniao" && webCancellationRequested(opts.history)));
    const data: any = await opts.transport({ model: opts.model, temperature: opts.temperature, messages, tools: allowedTools }, signal);
    const msg = data?.choices?.[0]?.message;
    const calls = msg?.tool_calls ?? [];
    if (!calls.length) return { text: String(msg?.content ?? "").trim() };
    messages.push(msg);
    for (const call of calls) {
      let args: unknown = null;
      try { args = JSON.parse(call.function?.arguments ?? "null"); } catch { /* inválido */ }
      const result = await opts.runTool(String(call.function?.name ?? ""), args);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result ?? { outcome: "error" }) });
    }
  }
  return { text: "" };
}
