// Geração da Clara no servidor. Credencial OPENAI_API_KEY só no servidor.
// Modelo/temperatura vêm da config do banco (padrão gpt-4.1 / 0.5).
import { buildSystemPrompt, CLARA_EMPRESA_ID, parseContact, type Contact } from "./clara-chat";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

type Msg = { role: "user" | "assistant"; content: string };
type Admin = { from: (t: string) => any };

export class ClaraNotConfiguredError extends Error {}

export async function loadSystemPrompt(admin: Admin, promptIds: number[]) {
  const [{ data: prompts, error: e1 }, { data: kb, error: e2 }] = await Promise.all([
    admin.from("prompt_especifico").select("id,node,prompt").eq("id_empresa", CLARA_EMPRESA_ID).in("id", promptIds),
    admin.from("empresa_conhecimento").select("titulo,categoria,conteudo,ordem").eq("id_empresa", CLARA_EMPRESA_ID),
  ]);
  if (e1 || e2) throw new Error("prompt_load_failed");
  return buildSystemPrompt(promptIds, prompts ?? [], kb ?? []);
}

const TOOLS = [{
  type: "function",
  function: {
    name: "registrar_contato",
    description: "Registra nome, e-mail e/ou telefone que o próprio visitante informou nesta conversa. Nunca invente dados.",
    parameters: {
      type: "object",
      properties: {
        nome: { type: "string" },
        email: { type: ["string", "null"] },
        telefone: { type: ["string", "null"] },
      },
      required: ["nome", "email", "telefone"],
      additionalProperties: false,
    },
    strict: true,
  },
}];

/** Corpo Chat Completions -> JSON de resposta Chat Completions. */
export type CompletionTransport = (body: Record<string, unknown>) => Promise<any>;

/** Cliente OpenAI direto, isolado. Usado só se OPENAI_API_KEY existir no runtime. */
function openAiDirectTransport(apiKey: string): CompletionTransport {
  return async (body) => {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`openai_${res.status}`);
    return res.json();
  };
}

/**
 * Seleciona o transporte da mesma conta/modelo OpenAI. Sem OPENAI_API_KEY,
 * o fallback é a ponte n8n abaixo. Se a RPC do job não existir, fail-closed.
 * Nunca usa outro provedor/modelo.
 */
export const BRIDGE_URL = "https://n8n2.katsuki.com.br/webhook/clara-web-inference-v1";
export const BRIDGE_TIMEOUT_MS = 95_000;

/**
 * Ponte n8n (mesma conta OpenAI, sem extrair chave): cria job via RPC
 * service_role (token de uso único, 2 min) e envia só {job_id, token} ao
 * webhook. Job/token nunca saem do servidor. Modelo forçado no payload.
 */
export function n8nBridgeTransport(admin: { rpc: (fn: string, args: Record<string, unknown>) => any }, fetchImpl: typeof fetch = fetch): CompletionTransport {
  return async (body) => {
    const payload = { ...body, model: "gpt-4.1", temperature: 0.5, max_tokens: 1800, stream: false };
    const { data, error } = await admin.rpc("clara_web_inference_create", { p_payload: payload });
    const job = Array.isArray(data) ? data[0] : data;
    if (error || !job?.job_id || !job?.token) throw new ClaraNotConfiguredError();
    const res = await fetchImpl(BRIDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: job.job_id, token: job.token }),
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`bridge_${res.status}`);
    const out = await res.json();
    if (!Array.isArray(out?.choices)) throw new Error("bridge_invalid_response");
    return out;
  };
}

/** OPENAI_API_KEY no runtime -> cliente direto; senão -> ponte n8n. */
export function resolveCompletionTransport(admin?: Parameters<typeof n8nBridgeTransport>[0]): CompletionTransport | null {
  const apiKey = String(process.env["OPENAI_API_KEY"] ?? "").trim();
  if (apiKey) return openAiDirectTransport(apiKey);
  return admin ? n8nBridgeTransport(admin) : null;
}

export async function generateClaraReply(opts: {
  system: string; history: Msg[]; greeting: boolean; model: string; temperature: number;
  transport?: CompletionTransport | null;
}): Promise<{ text: string; contact: Contact | null }> {
  const transport = opts.transport ?? resolveCompletionTransport();
  if (!transport) throw new ClaraNotConfiguredError();
  const messages: any[] = [{ role: "system", content: opts.system }, ...opts.history];
  if (opts.greeting) messages.push({ role: "system", content: "O visitante acabou de abrir o chat do site. Apresente-se conforme suas instruções, em uma mensagem curta." });
  let contact: Contact | null = null;
  for (let step = 0; step < 3; step++) {
    const data: any = await transport({ model: opts.model, temperature: opts.temperature, messages, tools: TOOLS });
    const msg = data?.choices?.[0]?.message;
    const calls = msg?.tool_calls ?? [];
    if (!calls.length) return { text: String(msg?.content ?? "").trim(), contact };
    messages.push(msg);
    for (const call of calls) {
      let ok = false;
      if (call.function?.name === "registrar_contato") {
        try { const c = parseContact(JSON.parse(call.function.arguments)); if (c) { contact = c; ok = true; } } catch { /* inválido */ }
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(ok ? { registrado: true } : { registrado: false, motivo: "dados inválidos ou incompletos" }) });
    }
  }
  return { text: "", contact };
}
