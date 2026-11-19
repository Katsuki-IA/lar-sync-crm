// Regras puras do chat web da Clara (sem segredos, testáveis).
// O texto de sistema vem SEMPRE do banco (prompt_especifico + empresa_conhecimento);
// aqui só há a montagem e uma nota técnica de canal, sem prompt paralelo.

export const CLARA_EMPRESA_ID = 38;

export type PromptRow = { id: number; node: string | null; prompt: string | null };
export type KnowledgeRow = { titulo: string | null; categoria: string | null; conteudo: string | null; ordem: number | null };

export const WEB_CHANNEL_NOTE =
  "Canal atual: chat no site (não é WhatsApp). Não há envio de mensagens, áudios ou imagens por WhatsApp neste canal. " +
  "Nesta fase, agendamento de reunião não está disponível pelo site: quando o visitante quiser agendar, peça nome, e-mail e, se ele quiser, telefone, " +
  "registre com a ferramenta registrar_contato e informe que a equipe Katsuki entrará em contato para confirmar o horário. Nunca invente horários nem confirme reserva.";

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

export type BeginStatus = "proceed" | "done" | "busy" | "rate_limited" | "disabled" | "no_session" | "invalid" | "failed";

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
