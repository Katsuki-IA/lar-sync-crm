export type JourneyFunnelLead = {
  id: number;
  leadId: number | null;
  telefones: Array<string | null | undefined>;
  idEmpresa: number;
  leadQuente: boolean | null;
  legacyEngaged?: boolean;
  legacyQualified?: boolean;
};

export type JourneyFunnelInput = {
  leads: JourneyFunnelLead[];
  messages: Array<{ sessionId: string; type: string | null }>;
  activities: Array<{ leadId: number; event: string | null; descricao: string | null }>;
  appointments: Array<{ legacyLeadId: number }>;
};

export type JourneyFunnelCounts = {
  received: number;
  engaged: number;
  hot: number;
  sentToCrm: number;
  scheduled: number;
};

export type JourneyFunnelLeadStages = JourneyFunnelCounts & {
  leadId: number;
};

const LEGACY_CRM_SENT_DESCRIPTION = "lead enviado ao crm cv com sucesso";

export function createJourneySessionIds(
  phone: string | null | undefined,
  empresaId: number,
): string[] {
  const digits = (phone ?? "").replace(/\D/g, "");

  if (!digits) return [];

  const variations = [digits];
  if (digits.length > 11) variations.push(digits.slice(-11));

  return [...new Set(variations.map((value) => `${value}${empresaId}`))];
}

export function calculateJourneyFunnelLeadStages({
  leads,
  messages,
  activities,
  appointments,
}: JourneyFunnelInput): JourneyFunnelLeadStages[] {
  const humanSessions = new Set(
    messages
      .filter((message) => message.type?.toLowerCase() === "human")
      .map((message) => message.sessionId),
  );

  const aiConversationLeadIds = new Set(
    activities
      .filter((activity) => activity.event?.toLowerCase() === "ai_conversation_exchange")
      .map((activity) => activity.leadId),
  );

  const sentToCrmLeadIds = new Set(
    activities
      .filter((activity) => {
        const hasEvent = activity.event === "external_crm_sent";
        const hasLegacyDescription = activity.descricao
          ?.toLowerCase()
          .includes(LEGACY_CRM_SENT_DESCRIPTION);

        return hasEvent || hasLegacyDescription;
      })
      .map((activity) => activity.leadId),
  );

  const scheduledLegacyLeadIds = new Set(
    appointments.map((appointment) => appointment.legacyLeadId),
  );

  return leads.map((lead) => {
    const hasHumanMessage =
      lead.telefones
        .flatMap((telefone) => createJourneySessionIds(telefone, lead.idEmpresa))
        .some((sessionId) => humanSessions.has(sessionId)) ||
      Boolean(lead.legacyEngaged) ||
      aiConversationLeadIds.has(lead.id);

    return {
      leadId: lead.id,
      received: 1,
      engaged: hasHumanMessage ? 1 : 0,
      hot: lead.leadQuente || lead.legacyQualified ? 1 : 0,
      sentToCrm: sentToCrmLeadIds.has(lead.id) ? 1 : 0,
      scheduled: lead.leadId !== null && scheduledLegacyLeadIds.has(lead.leadId) ? 1 : 0,
    };
  });
}

export function calculateJourneyFunnel(input: JourneyFunnelInput): JourneyFunnelCounts {
  return calculateJourneyFunnelLeadStages(input).reduce<JourneyFunnelCounts>(
    (counts, stages) => ({
      received: counts.received + stages.received,
      engaged: counts.engaged + stages.engaged,
      hot: counts.hot + stages.hot,
      sentToCrm: counts.sentToCrm + stages.sentToCrm,
      scheduled: counts.scheduled + stages.scheduled,
    }),
    { received: 0, engaged: 0, hot: 0, sentToCrm: 0, scheduled: 0 },
  );
}
