export const LEAD_ORIGIN_OPTIONS = [
  { value: "AP", label: "Aplicativo" },
  { value: "AT", label: "Módulo de Atendimento" },
  { value: "BC", label: "Busca Compartilhada" },
  { value: "BO", label: "Busca Orgânica" },
  { value: "CH", label: "Chat Online" },
  { value: "CB", label: "ChatBot" },
  { value: "DP", label: "Display" },
  { value: "EM", label: "Email" },
  { value: "FB", label: "Facebook" },
  { value: "GO", label: "Google" },
  { value: "IT", label: "InstaPage" },
  { value: "IG", label: "Instagram" },
  { value: "LI", label: "Ligação" },
  { value: "LK", label: "LinkedIn" },
  { value: "MP", label: "Mídia Paga" },
  { value: "OP", label: "Outras publicidades" },
  { value: "PA", label: "Painel" },
  { value: "PO", label: "Portais" },
  { value: "RF", label: "Referência" },
  { value: "SC", label: "Social" },
  { value: "TD", label: "Tráfego Direto" },
  { value: "TW", label: "Twitter" },
  { value: "SI", label: "WebSite" },
  { value: "UK", label: "Desconhecido" },
  { value: "ND", label: "Não Definido" },
  { value: "RM", label: "Remarketing" },
  { value: "PR", label: "Pinterest" },
  { value: "TT", label: "Tik Tok" },
  { value: "WA", label: "Whatsapp" },
  { value: "OU", label: "Outros" },
] as const;

export type LeadOriginCode = (typeof LEAD_ORIGIN_OPTIONS)[number]["value"];

export const DEFAULT_LEAD_ORIGIN: LeadOriginCode = "ND";

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const ORIGIN_BY_KEY = new Map<string, LeadOriginCode>();

for (const option of LEAD_ORIGIN_OPTIONS) {
  ORIGIN_BY_KEY.set(option.value.toLowerCase(), option.value);
  ORIGIN_BY_KEY.set(normalizeKey(option.label), option.value);
}

ORIGIN_BY_KEY.set("meta lead ads", "FB");
ORIGIN_BY_KEY.set("facebook lead ads", "FB");
ORIGIN_BY_KEY.set("site", "SI");
ORIGIN_BY_KEY.set("web site", "SI");
ORIGIN_BY_KEY.set("whats app", "WA");

export function resolveLeadOrigin(origem?: unknown, modulo?: unknown): LeadOriginCode {
  for (const candidate of [origem, modulo]) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const resolved = ORIGIN_BY_KEY.get(normalizeKey(candidate));
    if (resolved) return resolved;
  }
  return DEFAULT_LEAD_ORIGIN;
}

export function getLeadOriginLabel(value?: string | null) {
  const code = resolveLeadOrigin(value);
  return LEAD_ORIGIN_OPTIONS.find((option) => option.value === code)?.label ?? "Não Definido";
}

export function formatLeadOrigin(value?: string | null) {
  const code = resolveLeadOrigin(value);
  return `${code} - ${getLeadOriginLabel(code)}`;
}
