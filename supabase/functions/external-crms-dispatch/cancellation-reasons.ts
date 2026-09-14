export type CvCancellationReason = {
  id: string | number;
  nome: string;
};

export type CvCancellationSelection = {
  reason: CvCancellationReason;
  source: "provided" | "rules";
};

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeLabel(value?: string | null) {
  return stripDiacritics(String(value ?? "").trim()).toLowerCase();
}

function findReasonByAliases(reasons: CvCancellationReason[], aliases: string[]) {
  for (const alias of aliases) {
    const normalizedAlias = normalizeLabel(alias);
    const exact = reasons.find((reason) => normalizeLabel(reason.nome) === normalizedAlias);
    if (exact) return exact;
  }

  for (const alias of aliases) {
    const normalizedAlias = normalizeLabel(alias);
    const partial = reasons.find((reason) => normalizeLabel(reason.nome).includes(normalizedAlias));
    if (partial) return partial;
  }

  return null;
}

const NO_RESPONSE_REASON_ALIASES = [
  "nao respondeu apos as tentativas",
  "nao respondeu as tentativas",
  "nao respondeu",
  "nao atende ligacoes, e-mail e whatsapp",
  "nao atende ligacoes",
  "nao atende",
  "sem retorno",
  "nao retornou",
  "tentativas de contato",
];

const GENERIC_REASON_ALIASES = [
  "nao tem interesse no momento",
  "sem interesse",
  "nao tem interesse",
  "desistencia",
  "apenas curioso e pesquisando",
];

function fallbackCvCancellationReason(
  reasons: CvCancellationReason[],
  context: string,
  reasonKind?: string | null,
): CvCancellationReason {
  const normalizedContext = normalizeLabel(context);
  const normalizedReasonKind = normalizeLabel(reasonKind).replace(/[\s-]+/g, "_");

  if (normalizedReasonKind === "followup_no_response") {
    return (
      findReasonByAliases(reasons, NO_RESPONSE_REASON_ALIASES) ??
      findReasonByAliases(reasons, GENERIC_REASON_ALIASES) ??
      reasons[0]
    );
  }

  const rules: Array<{ context: string[]; reason: string[] }> = [
    {
      context: [
        "nao respondeu",
        "sem resposta",
        "nao retornou",
        "sem retorno",
        "nao atende ligacoes",
        "nao atende o telefone",
      ],
      reason: NO_RESPONSE_REASON_ALIASES,
    },
    {
      context: [
        "credito reprovado",
        "credito negado",
        "financiamento reprovado",
        "financiamento negado",
      ],
      reason: ["credito reprovado", "sem condicoes financeiras"],
    },
    {
      context: [
        "sem condicoes financeiras",
        "nao tem condicoes financeiras",
        "nao possui condicoes financeiras",
        "nao consegue pagar",
        "nao cabe no orcamento",
        "renda insuficiente",
        "achou caro",
        "muito caro",
        "valor muito alto",
        "entrada muito alta",
      ],
      reason: ["sem condicoes financeiras", "financeir"],
    },
    {
      context: ["sem interesse", "nao tem interesse", "nao possui interesse"],
      reason: GENERIC_REASON_ALIASES,
    },
    {
      context: [
        "localizacao nao atende",
        "nao gostou da localizacao",
        "muito longe",
        "distante demais",
      ],
      reason: ["localizacao", "produto nao atende"],
    },
    {
      context: [
        "tipologia nao atende",
        "planta nao atende",
        "metragem nao atende",
        "quantidade de quartos nao atende",
      ],
      reason: ["tipologia", "produto nao atende"],
    },
    {
      context: ["comprou outro imovel", "ja comprou outro", "ja alugou outro"],
      reason: ["comprou outro imovel", "alugou o imovel"],
    },
    {
      context: ["contato invalido", "numero invalido", "telefone invalido"],
      reason: ["dados de contato invalido"],
    },
  ];

  for (const rule of rules) {
    if (!rule.context.some((term) => normalizedContext.includes(term))) continue;
    const match = findReasonByAliases(reasons, rule.reason);
    if (match) return match;
  }

  return findReasonByAliases(reasons, GENERIC_REASON_ALIASES) ?? reasons[0];
}

export function selectCvCancellationReason(args: {
  reasons: CvCancellationReason[];
  context: string;
  providedId?: string | number;
  providedName?: string;
  reasonKind?: string | null;
}): CvCancellationSelection {
  const providedId = String(args.providedId ?? "").trim();
  const providedName = normalizeLabel(args.providedName);
  if (providedId || providedName) {
    const providedMatch = args.reasons.find(
      (reason) =>
        (providedId && String(reason.id) === providedId) ||
        (providedName && normalizeLabel(reason.nome) === providedName),
    );
    if (!providedMatch) {
      throw new Error("O motivo de cancelamento informado não está ativo no CV.");
    }
    return { reason: providedMatch, source: "provided" };
  }

  return {
    reason: fallbackCvCancellationReason(args.reasons, args.context, args.reasonKind),
    source: "rules",
  };
}
