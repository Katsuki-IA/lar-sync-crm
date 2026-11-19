// Regras puras do chat web da Clara (sem segredos, testáveis).
// O texto de sistema vem SEMPRE do banco (prompt_especifico + empresa_conhecimento);
// aqui só há a montagem e uma nota técnica de canal, sem prompt paralelo.

export const CLARA_EMPRESA_ID = 38;

export type PromptRow = { id: number; node: string | null; prompt: string | null };
export type KnowledgeRow = { titulo: string | null; categoria: string | null; conteudo: string | null; ordem: number | null };

export const WEB_CHANNEL_NOTE =
  "Canal atual: chat no site da Katsuki (não é WhatsApp); não há envio de áudio, imagem ou mensagem por WhatsApp neste canal. " +
  "Use registrar_contato apenas com dados que o visitante escreveu nesta conversa. Para agendar a reunião é preciso nome e telefone do visitante; " +
  "use consultar_horarios e agendar_reuniao e só confirme uma reserva quando a ferramenta retornar outcome created ou rescheduled. " +
  "Não envie nem prometa link de Meet, convite de calendário ou contato da equipe: diga apenas o que a ferramenta confirmou. " +
  "Use a data e hora atuais informadas pelo sistema a cada turno; nunca invente dia ou horário. " +
  "Continue a conversa a partir do histórico: se o visitante aceitou a reunião, não recomece a qualificação. " +
  "Para agendar, pergunte primeiro se prefere manhã ou tarde; depois ofereça no máximo 2 horários simples (ex.: amanhã às 9h ou 10h). " +
  "Uma escolha explícita do visitante basta: agende sem pedir nova confirmação. Não ofereça ajustar ou trocar horário por conta própria.";

export function buildSystemPrompt(promptIds: number[], prompts: PromptRow[], knowledge: KnowledgeRow[]): string {
  const byId = new Map(prompts.map((p) => [Number(p.id), p]));
  const parts: string[] = [];
  for (const id of promptIds) {
    const row = byId.get(Number(id));
    const text = row?.prompt?.trim();
    if (!text) throw new Error(`prompt_missing:${id}`);
    parts.push(`# ${row?.node ?? `Prompt ${id}`}\n${text}`);
  }
  const kb = [...knowledge]
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .filter((k) => k.conteudo?.trim())
    .map((k) => `## ${k.titulo ?? k.categoria ?? "Conhecimento"}\n${k.conteudo!.trim()}`);
  if (kb.length) parts.push(`# Base de conhecimento\n${kb.join("\n\n")}`);
  parts.push(`# Canal\n${WEB_CHANNEL_NOTE}`);
  return parts.join("\n\n");
}

export type ContactInput = { nome?: unknown; email?: unknown; telefone?: unknown };
export type Contact = { nome: string; email: string | null; telefone: string | null };

/** Valida dados informados pelo próprio visitante. Nunca inventa telefone. */
export function parseContact(input: ContactInput): Contact | null {
  const nome = typeof input.nome === "string" ? input.nome.trim() : "";
  if (nome.length < 2 || nome.length > 120) return null;
  const emailRaw = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const email = emailRaw && /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/.test(emailRaw) ? emailRaw : null;
  const digits = typeof input.telefone === "string" ? input.telefone.replace(/\D/g, "") : "";
  const telefone = digits.length >= 10 && digits.length <= 13 ? digits : null;
  if (!email && !telefone) return null;
  return { nome, email, telefone };
}

export type BeginStatus = "proceed" | "done" | "busy" | "rate_limited" | "disabled" | "no_session" | "invalid" | "failed" | "lease_lost";

export function statusToHttp(status: BeginStatus | "ai_not_configured" | "lease_lost"): number {
  switch (status) {
    case "busy": return 409;
    case "rate_limited": return 429;
    case "disabled": case "ai_not_configured": return 503;
    case "no_session": return 401;
    case "invalid": return 400;
    case "failed": case "lease_lost": return 502;
    default: return 200;
  }
}

function normalize(v: string) {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Telefone só vale com os dígitos literais do visitante, ou com o país 55 acrescentado a um número BR (10/11 dígitos). */
export function phoneWrittenByUser(telefone: string, digitsPerMsg: string[]): boolean {
  if (digitsPerMsg.some((d) => d.includes(telefone))) return true;
  const m = /^55(\d{10,11})$/.exec(telefone);
  return !!m && digitsPerMsg.some((d) => d.includes(m[1]));
}

/** Só aceita dados que aparecem literalmente nas mensagens do próprio visitante. */
export function contactFromUserMessages(contact: Contact, userTexts: string[]): Contact | null {
  const text = normalize(userTexts.join(" \n "));
  const digitsPerMsg = userTexts.map((t) => t.replace(/\D/g, ""));
  if (!text.includes(normalize(contact.nome))) return null;
  const email = contact.email && text.includes(contact.email) ? contact.email : null;
  const telefone = contact.telefone && phoneWrittenByUser(contact.telefone, digitsPerMsg) ? contact.telefone : null;
  if (contact.email && !email) return null;
  if (contact.telefone && !telefone) return null;
  return { nome: contact.nome, email, telefone };
}

export const ALLOWED_ORIGINS = [
  "https://myhub.katsuki.com.br",
  "https://lar-sync-crm.lovable.app",
  "https://id-preview--49e843b7-5b71-4684-91bf-93d45886e53a.lovable.app",
  "https://project--49e843b7-5b71-4684-91bf-93d45886e53a.lovable.app",
  "https://project--49e843b7-5b71-4684-91bf-93d45886e53a-dev.lovable.app",
];

/** Origin obrigatório: mesmo host da requisição ou domínio publicado/preview conhecido. */
export function isAllowedOrigin(origin: string | null, requestUrl: string): boolean {
  if (!origin) return false;
  try {
    const o = new URL(origin);
    const r = new URL(requestUrl);
    if (o.origin === r.origin) return true;
    return ALLOWED_ORIGINS.includes(o.origin);
  } catch { return false; }
}

export const MAX_BODY_BYTES = 8192;
export const INFERENCE_DEADLINE_MS = 95_000;

/** Hub > Chat web: super_admin ou gestor, com a empresa da Clara ativa (o banco revalida). */
export function canSeeWebChat(role: string | undefined, activeEmpresaId: number | null): boolean {
  return activeEmpresaId === CLARA_EMPRESA_ID && (role === "super_admin" || role === "manager");
}
