export type JourneyFunnelLead = {
  id: number;
  leadId: number | null;
  telefones: Array<string | null | undefined>;
  idEmpresa: number;
  leadQuente: boolean | null;
  legacyEngaged?: boolean;
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

export function calculateJourneyFunnel({
  leads,
  messages,
  activities,
  appointments,
}: JourneyFunnelInput): JourneyFunnelCounts {
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

  return leads.reduce<JourneyFunnelCounts>(
    (counts, lead) => {
      const hasHumanMessage = lead.telefones
        .flatMap((telefone) => createJourneySessionIds(telefone, lead.idEmpresa))
        .some((sessionId) => humanSessions.has(sessionId)) ||
        Boolean(lead.legacyEngaged) ||
        aiConversationLeadIds.has(lead.id);

      counts.received += 1;
      if (hasHumanMessage) counts.engaged += 1;
      if (lead.leadQuente) counts.hot += 1;
      if (sentToCrmLeadIds.has(lead.id)) counts.sentToCrm += 1;
      if (lead.leadId !== null && scheduledLegacyLeadIds.has(lead.leadId)) {
        counts.scheduled += 1;
      }

      return counts;
    },
    { received: 0, engaged: 0, hot: 0, sentToCrm: 0, scheduled: 0 },
  );
}
