const LEAD_ORIGIN_CODES = new Set([
  "AP", "AT", "BC", "BO", "CH", "CB", "DP", "EM", "FB", "GO",
  "IT", "IG", "LI", "LK", "MP", "OP", "PA", "PO", "RF", "SC",
  "TD", "TW", "SI", "UK", "ND", "RM", "PR", "TT", "WA", "OU",
]);

const LEAD_ORIGIN_ALIASES: Record<string, string> = {
  aplicativo: "AP",
  "modulo de atendimento": "AT",
  "busca compartilhada": "BC",
  "busca organica": "BO",
  "chat online": "CH",
  chatbot: "CB",
  display: "DP",
  email: "EM",
  facebook: "FB",
  "meta lead ads": "FB",
  "facebook lead ads": "FB",
  google: "GO",
  instapage: "IT",
  instagram: "IG",
  ligacao: "LI",
  linkedin: "LK",
  "midia paga": "MP",
  "outras publicidades": "OP",
  painel: "PA",
  portais: "PO",
  referencia: "RF",
  social: "SC",
  "trafego direto": "TD",
  twitter: "TW",
  website: "SI",
  "web site": "SI",
  site: "SI",
  desconhecido: "UK",
  "nao definido": "ND",
  remarketing: "RM",
  pinterest: "PR",
  "tik tok": "TT",
  tiktok: "TT",
  whatsapp: "WA",
  "whats app": "WA",
  outros: "OU",
};

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function resolveLeadOrigin(origem?: unknown, modulo?: unknown) {
  for (const candidate of [origem, modulo]) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const code = candidate.trim().toUpperCase();
    if (LEAD_ORIGIN_CODES.has(code)) return code;
    const alias = LEAD_ORIGIN_ALIASES[normalizeKey(candidate)];
    if (alias) return alias;
  }
  return "ND";
}
