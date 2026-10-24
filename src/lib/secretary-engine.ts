// Orquestração da interpretação de texto da Secretária — fase 1 (revisada).
// A engine NÃO executa nada no banco: ela apenas valida a entrada, roda a
// interpretação (comando legado ou IA, fora de qualquer transação) e produz
// um comando selado (SecretaryCommand). Toda a execução — trava do evento,
// verificação de replay, revalidação de remetente/módulo/configuração/oferta,
// operação, registro e resposta enfileirada — acontece em UMA chamada
// transacional (deps.finalize -> private.hub_secretary_finalize no banco).

import {
  parseLegacyCommand,
  parseListPageCommand,
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
  /** Instância do canal validada no servidor (necessária à revalidação). */
  instance: string;
  /** Telefone do remetente validado no servidor. */
  phone: string;
};

export type SecretaryAiSettings = {
  enabled: boolean;
  tone: SecretaryTone;
  basePrompt: string | null;
};

/** Comando selado: única entrada de execução aceita pelo banco. */
export type SecretaryCommand =
  | { kind: "legacy"; action: "accept" | "decline"; code: string }
  | { kind: "list"; limit: number; offset: number }
  | { kind: "respond"; action: "accept" | "decline"; reference: string | null }
  | { kind: "help" };

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
  /** Configuração de runtime (leitura interna, service_role). */
  loadRuntimeSettings(companyId: number): Promise<SecretaryAiSettings>;
  /** Interpretação via IA; erro/timeout devem ser sinalizados como null. */
  interpret(
    text: string,
    settings: SecretaryAiSettings,
  ): Promise<SecretaryInterpretation | null>;
  /**
   * Finalização transacional no banco: trava o evento, revalida tudo,
   * executa, registra e enfileira a resposta atomicamente. Chamada no
   * máximo uma vez por evento; replay é resolvido pelo próprio banco.
   */
  finalize(
    context: SecretaryMessageContext,
    body: string,
    command: SecretaryCommand,
  ): Promise<SecretaryResult>;
};

export const LEAD_LIST_LIMIT = 10;

const IGNORED: SecretaryResult = { status: "ignored", message: "" };

/**
 * Processa uma mensagem de texto recebida da secretária.
 * Garantias: identidade vem só do contexto validado no servidor e é
 * revalidada pelo banco na finalização; a IA só interpreta (nunca executa);
 * falha de IA vira ajuda sem mutação; comandos legados têm precedência.
 */
export async function processSecretaryMessage(
  text: string,
  context: SecretaryMessageContext,
  deps: SecretaryDeps,
): Promise<SecretaryResult> {
  const body = text.trim();
  if (!body || body.length > 500) return IGNORED;
  if (!context.memberActive || !context.crmEnabled) return IGNORED;

  // 1) Comando determinístico legado: ACEITAR/RECUSAR + código de 12 hex.
  const legacy = parseLegacyCommand(body);
  if (legacy) {
    return deps.finalize(context, body, {
      kind: "legacy",
      action: legacy.action,
      code: legacy.code,
    });
  }

  // 2) Comando determinístico de listagem paginada, antes da IA:
  // "meus leads" / "meus leads página N".
  const listPage = parseListPageCommand(body);
  if (listPage) {
    return deps.finalize(context, body, {
      kind: "list",
      limit: LEAD_LIST_LIMIT,
      offset: (listPage.page - 1) * LEAD_LIST_LIMIT,
    });
  }

  // 3) Interpretação por IA, somente se a capacidade estiver ativa.
  const settings = await deps.loadRuntimeSettings(context.companyId);
  if (!settings.enabled) {
    return deps.finalize(context, body, { kind: "help" });
  }
  const interpretation = await deps.interpret(body, settings);
  if (!interpretation || interpretation.intent === "desconhecido") {
    // Erro/timeout do modelo ou intenção fora do escopo: ajuda, sem mutação.
    return deps.finalize(context, body, { kind: "help" });
  }

  if (interpretation.intent === "listar") {
    return deps.finalize(context, body, {
      kind: "list",
      limit: LEAD_LIST_LIMIT,
      offset: 0,
    });
  }

  return deps.finalize(context, body, {
    kind: "respond",
    action: interpretation.intent === "aceitar" ? "accept" : "decline",
    reference: interpretation.reference,
  });
}
