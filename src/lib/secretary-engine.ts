// Orquestração da interpretação de texto da Secretária — fase 1.
// Toda dependência externa (banco, IA, outbox) é injetada, o que mantém o
// fluxo testável com fixtures e impede execução arbitrária: a engine só
// chama as operações explícitas declaradas em SecretaryDeps.

import {
  acceptedMessage,
  ambiguousOfferMessage,
  closedOfferMessage,
  declinedMessage,
  expiredMessage,
  helpMessage,
  leadListMessage,
  matchOfferByReference,
  offerNotFoundMessage,
  parseLegacyCommand,
  type LeadSummary,
  type PendingOffer,
  type SecretaryInterpretation,
  type SecretaryTone,
} from "./secretary-interpreter";

export type SecretaryMessageContext = {
  /** Empresa resolvida no servidor a partir do canal (instância) validado. */
  companyId: number;
  /** Membro resolvido no servidor a partir do telefone do remetente. */
  memberId: string;
  memberActive: boolean;
  crmEnabled: boolean;
  /** Identificador único do evento no provedor, para idempotência. */
  eventId: string;
  channel: string;
};

export type SecretaryAiSettings = {
  enabled: boolean;
  tone: SecretaryTone;
  basePrompt: string | null;
};

export type SecretaryResult = {
  status:
    | "ignored"
    | "replayed"
    | "listed"
    | "accepted"
    | "declined"
    | "expired"
    | "closed"
    | "not_found"
    | "ambiguous"
    | "invalid_command"
    | "help"
    | "unavailable";
  message: string;
};

export type SecretaryDeps = {
  /** Evento já processado (replay). Deve vir de leitura idempotente. */
  findIncoming(companyId: number, eventId: string): Promise<{
    memberId: string;
    body: string;
    result: SecretaryResult;
  } | null>;
  /** Registra o evento processado; deve falhar em duplicidade real. */
  recordIncoming(
    companyId: number,
    eventId: string,
    memberId: string,
    body: string,
    result: SecretaryResult,
  ): Promise<void>;
  /** Ofertas pendentes e não expiradas do próprio membro, na empresa. */
  listPendingOffers(companyId: number, memberId: string): Promise<PendingOffer[]>;
  /** Leads atribuídos ao membro na empresa, com limite. */
  listMyLeads(companyId: number, memberId: string, limit: number): Promise<LeadSummary[]>;
  /** Operação atômica existente de aceite/recusa; revalida tudo no banco. */
  respondOffer(
    offerId: string,
    action: "accept" | "decline",
    memberId: string,
  ): Promise<{ status: string }>;
  /** Enfileira a resposta no outbox; chamado no máximo uma vez por evento. */
  enqueueReply(companyId: number, memberId: string, body: string): Promise<void>;
  /** Interpretação via IA; erro/timeout devem ser sinalizados como null. */
  interpret(
    text: string,
    settings: SecretaryAiSettings,
  ): Promise<SecretaryInterpretation | null>;
  loadSettings(companyId: number): Promise<SecretaryAiSettings>;
};

export const LEAD_LIST_LIMIT = 10;

const IGNORED: SecretaryResult = { status: "ignored", message: "" };

/**
 * Processa uma mensagem de texto recebida da secretária.
 * Garantias: identidade vem só do contexto validado no servidor; replay do
 * mesmo evento devolve o resultado original sem reexecutar nem duplicar
 * outbox; falha de IA nunca muta nada; comandos legados têm precedência.
 */
export async function processSecretaryMessage(
  text: string,
  context: SecretaryMessageContext,
  deps: SecretaryDeps,
): Promise<SecretaryResult> {
  const body = text.trim();
  if (!body || body.length > 500) return IGNORED;
  if (!context.memberActive || !context.crmEnabled) return IGNORED;

  const previous = await deps.findIncoming(context.companyId, context.eventId);
  if (previous) {
    if (previous.memberId !== context.memberId || previous.body !== body) {
      throw new Error("Evento reutilizado com conteúdo diferente");
    }
    return { ...previous.result, status: "replayed" };
  }

  const settings = await deps.loadSettings(context.companyId);
  const tone = settings.tone;

  const finish = async (result: SecretaryResult): Promise<SecretaryResult> => {
    await deps.recordIncoming(context.companyId, context.eventId, context.memberId, body, result);
    if (result.message) await deps.enqueueReply(context.companyId, context.memberId, result.message);
    return result;
  };

  // 1) Comando determinístico legado: ACEITAR/RECUSAR + código de 12 hex.
  const legacy = parseLegacyCommand(body);
  if (legacy) {
    const offers = await deps.listPendingOffers(context.companyId, context.memberId);
    const offer = offers.find((o) => o.code.toUpperCase() === legacy.code);
    if (!offer) {
      return finish({ status: "not_found", message: offerNotFoundMessage(tone) });
    }
    return finish(await respondToOffer(offer, legacy.action, tone, context, deps));
  }

  // 2) Interpretação por IA, somente se a capacidade estiver instalada e ativa.
  if (!settings.enabled) {
    return finish({ status: "unavailable", message: helpMessage(tone) });
  }
  const interpretation = await deps.interpret(body, settings);
  if (!interpretation || interpretation.intent === "desconhecido") {
    // Erro/timeout do modelo ou intenção fora do escopo: ajuda, sem mutação.
    return finish({ status: "help", message: helpMessage(tone) });
  }

  if (interpretation.intent === "listar") {
    const leads = await deps.listMyLeads(context.companyId, context.memberId, LEAD_LIST_LIMIT);
    return finish({ status: "listed", message: leadListMessage(leads, tone) });
  }

  const offers = await deps.listPendingOffers(context.companyId, context.memberId);
  const match = matchOfferByReference(offers, interpretation.reference);
  if (match.kind === "none") {
    return finish({ status: "not_found", message: offerNotFoundMessage(tone) });
  }
  if (match.kind === "ambiguous") {
    return finish({ status: "ambiguous", message: ambiguousOfferMessage(match.matches, tone) });
  }
  return finish(
    await respondToOffer(
      match.offer,
      interpretation.intent === "aceitar" ? "accept" : "decline",
      tone,
      context,
      deps,
    ),
  );
}

async function respondToOffer(
  offer: PendingOffer,
  action: "accept" | "decline",
  tone: SecretaryTone,
  context: SecretaryMessageContext,
  deps: SecretaryDeps,
): Promise<SecretaryResult> {
  // Revalidação no momento da execução pela operação atômica existente.
  const outcome = await deps.respondOffer(offer.id, action, context.memberId);
  switch (outcome.status) {
    case "accepted":
      return { status: "accepted", message: acceptedMessage(offer, tone) };
    case "declined":
      return { status: "declined", message: declinedMessage(offer, tone) };
    case "expired":
      return { status: "expired", message: expiredMessage(tone) };
    default:
      return { status: "closed", message: closedOfferMessage(tone) };
  }
}
