import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type CrmUser = {
  id: string;
  id_empresa: number | null;
  role: string;
};

type CvCredentials = {
  cv_crm_url: string | null;
  cv_crm_token: string | null;
  cv_crm_email: string | null;
  default_crm: string | null;
};

type DispatchSettings = {
  external_stage_qualified_id: string | null;
  external_stage_visit_scheduled_id: string | null;
  external_stage_lost_id: string | null;
};

type CvSummaryResult = {
  ok: boolean;
  summary: string;
  used_fallback?: boolean;
  messages_count?: number;
  conversation_url?: string | null;
  whatsapp_url?: string | null;
};

async function getMe(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("crm_users")
    .select("id,id_empresa,role")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Usuário não cadastrado no CRM");
  return data as CrmUser;
}

function normalizeCrmKey(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function toScalarId(value?: string | null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return /^\d+$/.test(normalized) ? Number(normalized) : normalized;
}

function isSuccessfulExportActivity(activity: { descricao?: string | null; metadata?: any }) {
  if (activity?.metadata?.event === "external_crm_sent") return true;
  return String(activity?.descricao ?? "").toLowerCase().includes("lead enviado ao crm cv com sucesso");
}

async function parseResponsePayload(response: Response) {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

async function invokeCvSummaryFunction(args: {
  leadId: number;
  idEmpresa: number;
  accessToken: string;
}) {
  const supabaseUrl = String(process.env.SUPABASE_URL ?? "").trim();

  if (!supabaseUrl || !args.accessToken.trim()) {
    throw new Error("SUPABASE_URL ou token de acesso ausente para gerar resumo do CV.");
  }

  const response = await fetch(`${trimTrailingSlash(supabaseUrl)}/functions/v1/external-crms-cv-summary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.accessToken.trim()}`,
    },
    body: JSON.stringify({
      leadId: args.leadId,
      idEmpresa: args.idEmpresa,
    }),
  });

  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    const message =
      (typeof payload?.error === "string" && payload.error) ||
      (typeof payload?.message === "string" && payload.message) ||
      `Resumo CV retornou ${response.status}`;
    throw new Error(message);
  }

  return payload as CvSummaryResult;
}

function inferExternalId(payload: any): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
    payload.id,
    payload.lead_id,
    payload.idlead,
    payload.id_lead,
    payload?.data?.id,
    payload?.data?.lead_id,
    payload?.data?.idlead,
    payload?.lead?.id,
  ];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const normalized = String(candidate).trim();
    if (normalized) return normalized;
  }
  return null;
}

async function resolveLeadDestination(admin: any, lead: {
  id: number;
  id_empresa: number;
  id_empreendimento: number | null;
  crm_stage_id: number | null;
}) {
  let localEmpreendimentoId = lead.id_empreendimento;

  if (!localEmpreendimentoId) {
    const { data: leadContext, error: leadContextError } = await admin
      .from("lead")
      .select("empreendimento_em_foco_id")
      .eq("id_empresa", lead.id_empresa)
      .eq("id_crm", String(lead.id))
      .order("updated_at", { ascending: false })
      .limit(1);
    if (leadContextError) throw new Error(leadContextError.message);
    localEmpreendimentoId = leadContext?.[0]?.empreendimento_em_foco_id ?? null;
  }

  let cvEmpreendimentoId: string | number | null = null;
  if (localEmpreendimentoId) {
    const { data: empreendimento, error: empreendimentoError } = await admin
      .from("empreendimento")
      .select("cv_id_empreendimento")
      .eq("id", localEmpreendimentoId)
      .eq("id_empresa", lead.id_empresa)
      .maybeSingle();
    if (empreendimentoError) throw new Error(empreendimentoError.message);
    cvEmpreendimentoId = toScalarId(empreendimento?.cv_id_empreendimento ?? null);
  }

  return {
    localEmpreendimentoId,
    cvEmpreendimentoId,
  };
}

function resolveExternalStageId(stageName: string | null, settings: DispatchSettings) {
  const qualified = String(settings.external_stage_qualified_id ?? "").trim();
  const visitScheduled = String(settings.external_stage_visit_scheduled_id ?? "").trim();
  const lost = String(settings.external_stage_lost_id ?? "").trim();

  if (!qualified) {
    throw new Error("O ID externo de Qualificado não está configurado para esta empresa.");
  }

  if (stageName === "Perdido") return lost || qualified;
  if (stageName === "Visita Agendada") return visitScheduled || qualified;
  return qualified;
}

async function moveLeadToSentStage(admin: any, leadId: number, idEmpresa: number) {
  let sentStage =
    (await admin
      .from("crm_stages")
      .select("id,nome")
      .eq("id_empresa", idEmpresa)
      .eq("nome", "Enviado ao CRM")
      .eq("ativo", true)
      .limit(1)).data?.[0] ?? null;

  if (!sentStage) {
    const syncResult = await admin.rpc("crm_sync_company_global_config", {
      p_id_empresa: idEmpresa,
    });
    if (syncResult.error) throw new Error(syncResult.error.message);

    const retry = await admin
      .from("crm_stages")
      .select("id,nome")
      .eq("id_empresa", idEmpresa)
      .eq("nome", "Enviado ao CRM")
      .eq("ativo", true)
      .limit(1);
    if (retry.error) throw new Error(retry.error.message);
    sentStage = retry.data?.[0] ?? null;
  }

  if (!sentStage) return null;

  const { data: leadBefore, error: leadBeforeError } = await admin
    .from("crm_leads")
    .select("crm_stage_id")
    .eq("id", leadId)
    .maybeSingle();
  if (leadBeforeError) throw new Error(leadBeforeError.message);

  if (leadBefore?.crm_stage_id === sentStage.id) {
    return sentStage;
  }

  const oldStageId = leadBefore?.crm_stage_id ?? null;
  const oldStageName =
    oldStageId != null
      ? (
          await admin
            .from("crm_stages")
            .select("nome")
            .eq("id", oldStageId)
            .limit(1)
        ).data?.[0]?.nome ?? "—"
      : "—";

  const { error: updateError } = await admin
    .from("crm_leads")
    .update({ crm_stage_id: sentStage.id, updated_at: new Date().toISOString() })
    .eq("id", leadId);
  if (updateError) throw new Error(updateError.message);

  return {
    ...sentStage,
    oldStageId,
    oldStageName,
  };
}

export const sendLeadToExternalCrm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ lead_id: z.number().int().positive() }).parse(d))
  .handler(async ({ data, context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "super_admin" && me.role !== "manager") {
      throw new Error("Sem permissão para enviar lead ao CRM.");
    }

    const request = getRequest();
    const authHeader = request?.headers.get("authorization") ?? "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

    if (!accessToken) {
      throw new Error("Não foi possível validar a sessão atual para gerar o resumo da conversa.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: lead, error: leadError } = await admin
      .from("crm_leads")
      .select("id,id_empresa,nome,telefone,email,crm_stage_id,id_empreendimento,crm_assigned_to")
      .eq("id", data.lead_id)
      .maybeSingle();
    if (leadError) throw new Error(leadError.message);
    if (!lead) throw new Error("Lead não encontrado.");

    if (me.role === "manager" && me.id_empresa !== lead.id_empresa) {
      throw new Error("Sem permissão para enviar lead de outra empresa.");
    }

    const { data: previousExportActivities, error: previousExportActivitiesError } = await admin
      .from("crm_lead_activities")
      .select("id,descricao,metadata")
      .eq("lead_id", lead.id)
      .eq("tipo", "crm_export");
    if (previousExportActivitiesError) throw new Error(previousExportActivitiesError.message);

    if ((previousExportActivities ?? []).some(isSuccessfulExportActivity)) {
      throw new Error("Este lead já foi enviado para o CRM.");
    }

    const [{ data: empresa, error: empresaError }, { data: credentials, error: credentialsError }] =
      await Promise.all([
        admin
          .from("empresa_dados")
          .select("id,nome,default_crm")
          .eq("id", lead.id_empresa)
          .maybeSingle(),
        admin
          .from("credentials")
          .select("default_crm,cv_crm_url,cv_crm_token,cv_crm_email")
          .eq("id_empresa", lead.id_empresa)
          .maybeSingle(),
      ]);

    if (empresaError) throw new Error(empresaError.message);
    if (credentialsError) throw new Error(credentialsError.message);
    if (!empresa) throw new Error("Empresa do lead não encontrada.");

    const crmKey = normalizeCrmKey(empresa.default_crm) || normalizeCrmKey((credentials as CvCredentials | null)?.default_crm);
    if (!["cv", "cv_crm"].includes(crmKey)) {
      throw new Error("O CRM padrão desta empresa não está configurado como CV.");
    }

    const cvCredentials = credentials as CvCredentials | null;
    const cvUrl = trimTrailingSlash(String(cvCredentials?.cv_crm_url ?? "").trim());
    const cvToken = String(cvCredentials?.cv_crm_token ?? "").trim();
    const cvEmail = String(cvCredentials?.cv_crm_email ?? "").trim();

    if (!cvUrl || !cvToken || !cvEmail) {
      throw new Error("As credenciais do CV CRM estão incompletas para esta empresa.");
    }

    const dispatchSettingsResult = await admin
      .from("crm_lead_dispatch_settings")
      .select("external_stage_qualified_id,external_stage_visit_scheduled_id,external_stage_lost_id")
      .eq("id_empresa", lead.id_empresa)
      .maybeSingle();
    if (dispatchSettingsResult.error) throw new Error(dispatchSettingsResult.error.message);
    const dispatchSettings = (dispatchSettingsResult.data ?? {
      external_stage_qualified_id: null,
      external_stage_visit_scheduled_id: null,
      external_stage_lost_id: null,
    }) as DispatchSettings;

    const stageResult = lead.crm_stage_id
      ? await admin
          .from("crm_stages")
          .select("id,nome")
          .eq("id", lead.crm_stage_id)
          .limit(1)
      : { data: [], error: null };
    if (stageResult.error) throw new Error(stageResult.error.message);
    const currentStageName = stageResult.data?.[0]?.nome ?? null;
    const externalStageId = resolveExternalStageId(currentStageName, dispatchSettings);

    const { localEmpreendimentoId, cvEmpreendimentoId } = await resolveLeadDestination(admin, lead);

    const requestPayload: Record<string, unknown> = {
      telefone: String(lead.telefone ?? "").trim(),
      nome: String(lead.nome ?? "").trim() || "Lead sem nome",
      origem: "WA",
      idsituacao: toScalarId(externalStageId),
      permitir_alteracao: true,
      tags: ["Atendimento IA"],
    };

    const email = String(lead.email ?? "").trim();
    if (email) requestPayload.email = email;
    if (cvEmpreendimentoId != null) requestPayload.idempreendimento = cvEmpreendimentoId;

    const sendLogBase = {
      id_empresa: lead.id_empresa,
      lead_id: lead.id,
      provider: "cv_crm",
      request_payload: requestPayload,
    };

    let responsePayload: any = null;
    let summaryPayload: CvSummaryResult | null = null;
    let summaryErrorMessage: string | null = null;

    try {
      try {
        summaryPayload = await invokeCvSummaryFunction({
          leadId: lead.id,
          idEmpresa: lead.id_empresa,
          accessToken,
        });
      } catch (error) {
        summaryErrorMessage = error instanceof Error
          ? error.message
          : "Falha ao gerar resumo da conversa para envio ao CV.";
      }

      if (summaryPayload?.summary) {
        requestPayload.interacoes = [
          {
            descricao: summaryPayload.summary,
            tipo: "W",
          },
        ];
      }

      const response = await fetch(`${cvUrl}/api/v1/comercial/leads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          token: cvToken,
          email: cvEmail,
          origemcv: "true",
        },
        body: JSON.stringify(requestPayload),
      });

      responsePayload = await parseResponsePayload(response);

      if (!response.ok) {
        const errorMessage =
          (typeof responsePayload?.message === "string" && responsePayload.message) ||
          (typeof responsePayload?.error === "string" && responsePayload.error) ||
          `CV CRM retornou ${response.status}`;

        await admin.from("crm_external_crm_send_logs").insert({
          ...sendLogBase,
          status: "failed",
          response_payload: responsePayload,
          error_message: errorMessage,
        });

        await admin.from("crm_lead_activities").insert({
          lead_id: lead.id,
          crm_user_id: me.id,
          tipo: "crm_export",
          descricao: `Falha ao enviar lead ao CRM CV: ${errorMessage}`,
          metadata: {
            source: "crm",
            event: "external_crm_failed",
            provider: "cv_crm",
            response: responsePayload,
          },
        });

        throw new Error(errorMessage);
      }

      await admin.from("crm_external_crm_send_logs").insert({
        ...sendLogBase,
        status: "sent",
        response_payload: {
          create_lead: responsePayload,
          conversation_summary: summaryPayload,
          summary_error: summaryErrorMessage,
        },
        external_id: inferExternalId(responsePayload),
      });

      let externalLeadStatusErrorMessage: string | null = null;
      const externalLeadStatusUpdate = await admin
        .from("lead")
        .update({
          status: "Enviado  CRM",
          updated_at: new Date().toISOString(),
        })
        .eq("id_empresa", lead.id_empresa)
        .eq("id_crm", String(lead.id))
        .select("id")
        .limit(1);

      if (externalLeadStatusUpdate.error) {
        externalLeadStatusErrorMessage = externalLeadStatusUpdate.error.message;
      } else if (!externalLeadStatusUpdate.data?.length) {
        externalLeadStatusErrorMessage =
          "Nenhum registro correspondente foi encontrado na tabela lead para marcar status como Enviado  CRM.";
      }

      const sentStage = await moveLeadToSentStage(admin, lead.id, lead.id_empresa);

      if (sentStage?.oldStageId != null && sentStage.oldStageId !== sentStage.id) {
        await admin.from("crm_lead_activities").insert({
          lead_id: lead.id,
          crm_user_id: me.id,
          tipo: "stage_change",
          descricao: `De ${sentStage.oldStageName ?? "—"} para ${sentStage.nome}`,
          metadata: {
            source: "crm",
            event: "lead_sent_to_external_crm_stage_change",
            provider: "cv_crm",
            old_stage_id: sentStage.oldStageId,
            new_stage_id: sentStage.id,
          },
        });
      }

      await admin.from("crm_lead_activities").insert({
        lead_id: lead.id,
        crm_user_id: me.id,
        tipo: "crm_export",
        descricao: "Lead enviado ao CRM CV com sucesso",
        metadata: {
          source: "crm",
          event: "external_crm_sent",
          provider: "cv_crm",
          external_id: inferExternalId(responsePayload),
          id_empreendimento_local: localEmpreendimentoId,
          cv_id_empreendimento: cvEmpreendimentoId,
          cv_stage_id: toScalarId(externalStageId),
          conversation_summary_synced: Boolean(summaryPayload?.summary),
          conversation_summary_error: summaryErrorMessage,
          conversation_summary_used_fallback: summaryPayload?.used_fallback ?? false,
          external_lead_status_updated: !externalLeadStatusErrorMessage,
          external_lead_status_error: externalLeadStatusErrorMessage,
        },
      });

      if (summaryErrorMessage) {
        await admin.from("crm_lead_activities").insert({
          lead_id: lead.id,
          crm_user_id: me.id,
          tipo: "crm_export",
          descricao: `Lead enviado ao CRM CV sem resumo de conversa: ${summaryErrorMessage}`,
          metadata: {
            source: "crm",
            event: "external_crm_summary_generation_failed",
            provider: "cv_crm",
            external_id: inferExternalId(responsePayload),
          },
        });
      }

      if (externalLeadStatusErrorMessage) {
        await admin.from("crm_lead_activities").insert({
          lead_id: lead.id,
          crm_user_id: me.id,
          tipo: "crm_export",
          descricao: `Lead enviado ao CRM CV, mas não foi possível atualizar o status externo para Enviado  CRM: ${externalLeadStatusErrorMessage}`,
          metadata: {
            source: "crm",
            event: "external_crm_external_lead_status_update_failed",
            provider: "cv_crm",
            external_id: inferExternalId(responsePayload),
          },
        });
      }

      return {
        ok: true,
        provider: "cv_crm",
        moved_to_stage: sentStage?.id ?? null,
        conversation_summary_synced: Boolean(summaryPayload?.summary),
        external_lead_status_updated: !externalLeadStatusErrorMessage,
      };
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error("Falha ao enviar lead para o CRM externo.");
    }
  });
