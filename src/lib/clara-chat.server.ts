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

export async function generateClaraReply(opts: {
  system: string; history: Msg[]; greeting: boolean; model: string; temperature: number;
}): Promise<{ text: string; contact: Contact | null }> {
  const apiKey = String(process.env["OPENAI_API_KEY"] ?? "").trim();
  if (!apiKey) throw new ClaraNotConfiguredError();
  const messages: any[] = [{ role: "system", content: opts.system }, ...opts.history];
  if (opts.greeting) messages.push({ role: "system", content: "O visitante acabou de abrir o chat do site. Apresente-se conforme suas instruções, em uma mensagem curta." });
  let contact: Contact | null = null;
  for (let step = 0; step < 3; step++) {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: opts.model, temperature: opts.temperature, messages, tools: TOOLS }),
    });
    if (!res.ok) throw new Error(`openai_${res.status}`);
    const data: any = await res.json();
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
