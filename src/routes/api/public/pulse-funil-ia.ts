// Leitura agregada do funil de atendimento da IA para o Katsuki Pulse.
// Somente SELECT: nenhuma escrita, nenhum efeito colateral.
import { createFileRoute } from "@tanstack/react-router";

import {
  calculateJourneyFunnel,
  createJourneySessionIds,
  type JourneyFunnelCounts,
} from "@/lib/journey-funnel";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-pulse-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function constantTimeEquals(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index]! ^ b[index]!;
  return diff === 0;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requiredDate(value: unknown, field: string) {
  const parsed = String(value ?? "").trim();
  if (!DATE_PATTERN.test(parsed)) throw new Error(`${field} inválido: use YYYY-MM-DD`);
  return parsed;
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function maskPhone(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `****${digits.slice(-4)}`;
}

function percent(value: number, base: number) {
  if (!base) return 0;
  return Math.round((value / base) * 1000) / 10;
}

function funnelPayload(counts: JourneyFunnelCounts) {
  const base = counts.received;
  return {
    leads_recebidos: { quantidade: counts.received, percentual: base ? 100 : 0 },
    interagiram_com_ia: { quantidade: counts.engaged, percentual: percent(counts.engaged, base) },
    leads_quentes: { quantidade: counts.hot, percentual: percent(counts.hot, base) },
    enviados_crm: { quantidade: counts.sentToCrm, percentual: percent(counts.sentToCrm, base) },
    visitas_agendadas: { quantidade: counts.scheduled, percentual: percent(counts.scheduled, base) },
  };
}

function metadataEvent(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const event = (metadata as { event?: unknown }).event;
  return typeof event === "string" ? event : null;
}

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

function unwrap<T>(result: { data: unknown; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as T;
}

type CohortLead = {
  id: number;
  lead_id: number | null;
  telefone: string | null;
  lead_quente: boolean | null;
  id_empresa: number;
  id_empreendimento: number | null;
  crm_stage_id: number | null;
};

type MappedLead = {
  id: number;
  leadId: number | null;
  telefones: Array<string | null | undefined>;
  idEmpresa: number;
  leadQuente: boolean | null;
  legacyEngaged: boolean;
  legacyQualified: boolean;
  idEmpreendimento: number | null;
  crmStageId: number | null;
};

type LegacyLead = {
  id: number;
  numero: string | null;
  qtd_interacoes: number | null;
  qualificado: number | null;
  status_history: string | null;
};

type ClassificationFull = {
  lead_id: number;
  cliente_respondeu: boolean | null;
  nao_respondeu_mais: boolean | null;
  lead_desqualificado: boolean | null;
  qualificado: boolean | null;
  visita_agendada: boolean | null;
  temperatura: string | null;
  message_count: number | null;
  human_count: number | null;
  ai_count: number | null;
  id_empreendimento: number | null;
};

function classificationSummary(rows: ClassificationFull[]) {
  const average = (values: Array<number | null>) => {
    const present = values.filter((value): value is number => typeof value === "number");
    if (!present.length) return 0;
    return Math.round((present.reduce((sum, value) => sum + value, 0) / present.length) * 10) / 10;
  };
  const temperatura = { frio: 0, morno: 0, quente: 0, nao_informado: 0 };
  for (const row of rows) {
    const key = (row.temperatura ?? "").toLowerCase();
    if (key === "frio" || key === "morno" || key === "quente") temperatura[key] += 1;
    else temperatura.nao_informado += 1;
  }
  return {
    total: rows.length,
    cliente_respondeu: rows.filter((row) => row.cliente_respondeu).length,
    nao_respondeu_mais: rows.filter((row) => row.nao_respondeu_mais).length,
    lead_desqualificado: rows.filter((row) => row.lead_desqualificado).length,
    qualificado: rows.filter((row) => row.qualificado).length,
    visita_agendada: rows.filter((row) => row.visita_agendada).length,
    temperatura,
    medias: {
      message_count: average(rows.map((row) => row.message_count)),
      human_count: average(rows.map((row) => row.human_count)),
      ai_count: average(rows.map((row) => row.ai_count)),
    },
  };
}

async function buildPeriod(
  admin: Admin,
  idEmpresa: number,
  de: string,
  ate: string,
  empreendimentos: number[],
) {
  const start = `${de}T00:00:00`;
  const end = `${ate}T23:59:59.999`;

  let cohortQuery = admin
    .from("crm_leads")
    .select("id,lead_id,telefone,lead_quente,id_empresa,id_empreendimento,crm_stage_id")
    .eq("id_empresa", idEmpresa)
    .gte("created_at", start)
    .lte("created_at", end);
  if (empreendimentos.length) cohortQuery = cohortQuery.in("id_empreendimento", empreendimentos);
  const cohort = unwrap<CohortLead[]>(await cohortQuery);

  // Leads legados vêm apenas pelos vínculos da coorte, nunca a tabela inteira.
  const legacyIds = cohort.flatMap((lead) => (lead.lead_id === null ? [] : [lead.lead_id]));
  const cohortPhones = [
    ...new Set(
      cohort.flatMap((lead) => {
        const digits = (lead.telefone ?? "").replace(/\D/g, "");
        if (!digits) return [] as string[];
        return digits.length > 11 ? [digits, digits.slice(-11)] : [digits];
      }),
    ),
  ];

  const legacySelect = "id,numero,qtd_interacoes,qualificado,status_history";
  const legacyLeads: LegacyLead[] = [];
  for (const group of chunk(legacyIds, 200)) {
    legacyLeads.push(
      ...unwrap<LegacyLead[]>(
        await admin.from("lead").select(legacySelect).eq("id_empresa", idEmpresa).in("id", group),
      ),
    );
  }
  for (const group of chunk(cohortPhones, 200)) {
    legacyLeads.push(
      ...unwrap<LegacyLead[]>(
        await admin.from("lead").select(legacySelect).eq("id_empresa", idEmpresa).in("numero", group),
      ),
    );
  }

  const legacyLeadById = new Map<number, LegacyLead>();
  for (const legacyLead of legacyLeads) legacyLeadById.set(legacyLead.id, legacyLead);
  const legacyLeadBySessionId = new Map<string, LegacyLead>();
  for (const legacyLead of legacyLeadById.values()) {
    for (const sessionId of createJourneySessionIds(legacyLead.numero, idEmpresa)) {
      legacyLeadBySessionId.set(sessionId, legacyLead);
    }
  }

  const cohortClassifications: Array<Pick<ClassificationFull, "lead_id" | "cliente_respondeu" | "qualificado">> = [];
  for (const group of chunk([...legacyLeadById.keys()], 200)) {
    cohortClassifications.push(
      ...unwrap<Array<Pick<ClassificationFull, "lead_id" | "cliente_respondeu" | "qualificado">>>(
        await admin
          .from("crm_conversation_classifications")
          .select("lead_id,cliente_respondeu,qualificado")
          .eq("id_empresa", idEmpresa)
          .in("lead_id", group),
      ),
    );
  }
  const classifiedResponse = new Set(
    cohortClassifications.filter((row) => row.cliente_respondeu).map((row) => row.lead_id),
  );
  const classifiedQualified = new Set(
    cohortClassifications.filter((row) => row.qualificado).map((row) => row.lead_id),
  );

  const mappedLeads: MappedLead[] = cohort.map((lead) => {
    const legacyLead =
      (lead.lead_id === null ? null : legacyLeadById.get(lead.lead_id)) ??
      createJourneySessionIds(lead.telefone, lead.id_empresa)
        .map((sessionId) => legacyLeadBySessionId.get(sessionId))
        .find(Boolean) ??
      null;
    const history = legacyLead?.status_history?.toLowerCase() ?? "";

    return {
      id: lead.id,
      leadId: lead.lead_id,
      telefones: [legacyLead?.numero, lead.telefone],
      idEmpresa: lead.id_empresa,
      leadQuente: lead.lead_quente,
      legacyEngaged:
        Boolean(legacyLead && classifiedResponse.has(legacyLead.id)) ||
        (legacyLead?.qtd_interacoes ?? 0) >= 2,
      legacyQualified:
        Boolean(legacyLead && classifiedQualified.has(legacyLead.id)) ||
        legacyLead?.qualificado === 1 ||
        (history.includes("qualificado") && !history.includes("desqualificado")),
      idEmpreendimento: lead.id_empreendimento,
      crmStageId: lead.crm_stage_id,
    };
  });

  const sessionIds = [
    ...new Set(
      mappedLeads.flatMap((lead) =>
        lead.telefones.flatMap((telefone) => createJourneySessionIds(telefone, lead.idEmpresa)),
      ),
    ),
  ];
  type ChatRow = { numero: string | null; type: string | null };
  const messages: ChatRow[] = [];
  for (const group of chunk(sessionIds, 150)) {
    messages.push(
      ...unwrap<ChatRow[]>(
        await admin.from("n8n_chat_conversas").select("numero,type").in("numero", group),
      ),
    );
  }

  type ActivityRow = { lead_id: number; metadata: unknown; descricao: string | null };
  const activities: ActivityRow[] = [];
  for (const group of chunk(mappedLeads.map((lead) => lead.id), 200)) {
    activities.push(
      ...unwrap<ActivityRow[]>(
        await admin
          .from("crm_lead_activities")
          .select("lead_id,metadata,descricao")
          .in("lead_id", group),
      ),
    );
  }

  type AppointmentRow = { id_lead: number | null };
  const appointments: AppointmentRow[] = [];
  const legacyCohortIds = mappedLeads.flatMap((lead) => (lead.leadId === null ? [] : [lead.leadId]));
  for (const group of chunk(legacyCohortIds, 200)) {
    appointments.push(
      ...unwrap<AppointmentRow[]>(
        await admin
          .from("agendamento")
          .select("id_lead")
          .eq("id_empresa", idEmpresa)
          .is("deleted_at", null)
          .in("id_lead", group),
      ),
    );
  }

  const funnelInput = {
    messages: messages.flatMap((message) =>
      message.numero ? [{ sessionId: message.numero, type: message.type }] : [],
    ),
    activities: activities.map((activity) => ({
      leadId: activity.lead_id,
      event: metadataEvent(activity.metadata),
      descricao: activity.descricao,
    })),
    appointments: appointments.flatMap((appointment) =>
      appointment.id_lead === null ? [] : [{ legacyLeadId: appointment.id_lead }],
    ),
  };

  const total = calculateJourneyFunnel({ leads: mappedLeads, ...funnelInput });

  const groups = new Map<number | null, MappedLead[]>();
  for (const lead of mappedLeads) {
    const list = groups.get(lead.idEmpreendimento) ?? [];
    list.push(lead);
    groups.set(lead.idEmpreendimento, list);
  }

  type SendLog = {
    lead_id: number | null;
    external_id: string | null;
    created_at: string;
    crm_leads: { telefone: string | null; id_empreendimento: number | null } | null;
  };
  const sendLogs = unwrap<SendLog[]>(
    await admin
      .from("crm_external_crm_send_logs")
      .select("lead_id,external_id,created_at,crm_leads(telefone,id_empreendimento)")
      .eq("id_empresa", idEmpresa)
      .eq("provider", "cv_crm")
      .eq("status", "sent")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: true }),
  ).filter((log) =>
    empreendimentos.length
      ? log.crm_leads?.id_empreendimento != null &&
        empreendimentos.includes(Number(log.crm_leads.id_empreendimento))
      : true,
  );

  let classificationQuery = admin
    .from("crm_conversation_classifications")
    .select(
      "lead_id,cliente_respondeu,nao_respondeu_mais,lead_desqualificado,qualificado,visita_agendada,temperatura,message_count,human_count,ai_count,id_empreendimento",
    )
    .eq("id_empresa", idEmpresa)
    .gte("created_at", start)
    .lte("created_at", end);
  if (empreendimentos.length) {
    classificationQuery = classificationQuery.in("id_empreendimento", empreendimentos);
  }
  const classifications = unwrap<ClassificationFull[]>(await classificationQuery);

  type StageRow = { id: number; nome: string; ordem: number | null };
  const stages = unwrap<StageRow[]>(
    await admin
      .from("crm_stages")
      .select("id,nome,ordem")
      .eq("id_empresa", idEmpresa)
      .order("ordem", { ascending: true }),
  );
  const stageCount = new Map<number | null, number>();
  for (const lead of mappedLeads) {
    stageCount.set(lead.crmStageId, (stageCount.get(lead.crmStageId) ?? 0) + 1);
  }
  const porEtapa = stages.map((stage) => ({
    id: stage.id,
    nome: stage.nome,
    quantidade: stageCount.get(stage.id) ?? 0,
  }));
  const semEtapa = stageCount.get(null) ?? 0;
  if (semEtapa) porEtapa.push({ id: 0, nome: "Sem etapa", quantidade: semEtapa });

  return {
    de,
    ate,
    funil: {
      total: funnelPayload(total),
      por_empreendimento: [...groups.entries()].map(([idEmpreendimento, leads]) => ({
        id_empreendimento: idEmpreendimento,
        ...funnelPayload(calculateJourneyFunnel({ leads, ...funnelInput })),
      })),
    },
    enviados_crm_detalhe: sendLogs.map((log) => ({
      lead_id: log.lead_id,
      external_id: log.external_id,
      enviado_em: log.created_at,
      id_empreendimento: log.crm_leads?.id_empreendimento ?? null,
      telefone_mascarado: maskPhone(log.crm_leads?.telefone),
    })),
    classificacao_conversas: {
      total: classificationSummary(classifications),
      por_empreendimento: [...new Set(classifications.map((row) => row.id_empreendimento))].map(
        (idEmpreendimento) => ({
          id_empreendimento: idEmpreendimento,
          ...classificationSummary(
            classifications.filter((row) => row.id_empreendimento === idEmpreendimento),
          ),
        }),
      ),
    },
    por_etapa: {
      total: porEtapa,
      por_empreendimento: [...groups.entries()].map(([idEmpreendimento, leads]) => {
        const counts = new Map<number | null, number>();
        for (const lead of leads) counts.set(lead.crmStageId, (counts.get(lead.crmStageId) ?? 0) + 1);
        return {
          id_empreendimento: idEmpreendimento,
          etapas: stages.map((stage) => ({
            id: stage.id,
            nome: stage.nome,
            quantidade: counts.get(stage.id) ?? 0,
          })),
        };
      }),
    },
  };
}

export const Route = createFileRoute("/api/public/pulse-funil-ia")({
  server: {
    handlers: {
      OPTIONS: async () => new Response("ok", { headers: corsHeaders }),
      POST: async ({ request }) => {
        const configuredKey = String(process.env["PULSE_BRIDGE_KEY"] ?? "").trim();
        if (!configuredKey) {
          return json({ error: "PULSE_BRIDGE_KEY não configurada no projeto" }, 503);
        }
        const suppliedKey = request.headers.get("x-pulse-key")?.trim() ?? "";
        if (!suppliedKey || !constantTimeEquals(suppliedKey, configuredKey)) {
          return json(
            { error: "Chave inválida: envie o header x-pulse-key com a PULSE_BRIDGE_KEY." },
            401,
          );
        }

        try {
          const raw = await request.text();
          const payload: unknown = raw.trim() ? JSON.parse(raw) : {};
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            throw new Error("Payload JSON inválido");
          }
          const body = payload as Record<string, unknown>;

          const idEmpresa = Number(body["id_empresa"]);
          if (!Number.isSafeInteger(idEmpresa) || idEmpresa <= 0) {
            throw new Error("id_empresa inválido");
          }
          const de = requiredDate(body["de"], "de");
          const ate = requiredDate(body["ate"], "ate");
          const previousRaw = body["de_anterior"];
          const hasPrevious = previousRaw !== undefined && previousRaw !== null && previousRaw !== "";
          const dePrevious = hasPrevious ? requiredDate(previousRaw, "de_anterior") : null;
          const atePrevious = hasPrevious ? requiredDate(body["ate_anterior"], "ate_anterior") : null;
          const empreendimentosInput = body["empreendimentos"];
          const empreendimentos = Array.isArray(empreendimentosInput)
            ? empreendimentosInput.map((value) => {
                const parsed = Number(value);
                if (!Number.isSafeInteger(parsed) || parsed <= 0) {
                  throw new Error("empreendimentos inválido");
                }
                return parsed;
              })
            : [];

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const empresa = await supabaseAdmin
            .from("empresa_dados")
            .select("id,nome")
            .eq("id", idEmpresa)
            .maybeSingle();
          if (empresa.error) throw new Error(empresa.error.message);
          if (!empresa.data) return json({ error: "Empresa não encontrada" }, 404);

          let empreendimentoQuery = supabaseAdmin
            .from("empreendimento")
            .select("id,nome,incorporadora,cv_id_empreendimento")
            .eq("id_empresa", idEmpresa)
            .order("nome", { ascending: true });
          if (empreendimentos.length) {
            empreendimentoQuery = empreendimentoQuery.in("id", empreendimentos);
          }
          const empreendimentosResult = await empreendimentoQuery;
          if (empreendimentosResult.error) throw new Error(empreendimentosResult.error.message);

          const freshness = await supabaseAdmin
            .from("crm_leads")
            .select("updated_at")
            .eq("id_empresa", idEmpresa)
            .order("updated_at", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
          if (freshness.error) throw new Error(freshness.error.message);

          const periodo = await buildPeriod(supabaseAdmin, idEmpresa, de, ate, empreendimentos);
          const periodoAnterior =
            dePrevious && atePrevious
              ? await buildPeriod(supabaseAdmin, idEmpresa, dePrevious, atePrevious, empreendimentos)
              : null;

          return json({
            empresa: { id: empresa.data.id, nome: empresa.data.nome },
            empreendimentos: empreendimentosResult.data ?? [],
            atualizado_em: freshness.data?.updated_at ?? null,
            periodo,
            periodo_anterior: periodoAnterior,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Erro interno";
          const isInputError = /inválido|inválida|JSON|YYYY/i.test(message);
          console.error("[pulse-funil-ia]", message);
          return json({ error: isInputError ? message : "Erro interno" }, isInputError ? 400 : 500);
        }
      },
    },
  },
});