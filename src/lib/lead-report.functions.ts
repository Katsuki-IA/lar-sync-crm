import type { SupabaseClient } from "@supabase/supabase-js";
import { companyApi } from "@/hml/company-api";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  companyId: z.number().int().positive(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function nextDay(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function chunks<T>(items: T[], size = 50) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}

function digits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function historyTags(value: string | null) {
  if (!value) return [] as string[];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed))
      return parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    // Older rows may store labels as plain text.
  }
  return value
    .split(/[,;|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export type LeadReportRow = {
  id: number;
  crmId: string | null;
  nome: string;
  numero: string | null;
  createdAt: string | null;
  empreendimentoId: number | null;
  empreendimento: string;
  stage: string;
  status: string | null;
  interactions: number;
  qualification: "pending" | "qualified" | "disqualified";
  human: boolean;
  blocked: boolean;
  blockReason: string | null;
  lost: boolean;
  visit: "none" | "active" | "cancelled";
  visitDays: string[];
  followups: string[];
};

export const getLeadReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value) => input.parse(value))
  .handler(async ({ data, context }): Promise<LeadReportRow[]> => {
    if (data.dateFrom > data.dateTo)
      throw new Error("A data inicial deve ser anterior à data final.");

    const { data: user, error: userError } = await context.supabase
      .from("crm_users")
      .select("role,active")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (userError) throw userError;
    if (!user?.active || !["manager", "super_admin", "analyst"].includes(user.role)) {
      throw new Error("Sem permissão para consultar o relatório de leads.");
    }
    const companies = companyApi(context.supabase as unknown as SupabaseClient);
    const allowed = await companies.allowed();
    if (!(allowed ?? []).includes(data.companyId)) throw new Error("Sem acesso a esta empresa.");
    const modules = await companies.modules(data.companyId);
    if (!modules?.atendimento_ia) throw new Error("Atendimento IA não habilitado para esta empresa.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const leads: Array<{
      id: number;
      id_crm: string | null;
      nome: string;
      numero: string | null;
      created_at: string | null;
      id_empreendimento: number | null;
      crm_stage_id: number | null;
      status: string | null;
      status_history: string | null;
      qtd_interacoes: number | null;
      qualificado: number | null;
      atendimento_humano: boolean | null;
    }> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: page, error } = await supabaseAdmin
        .from("lead")
        .select(
          "id,id_crm,nome,numero,created_at,id_empreendimento,crm_stage_id,status,status_history,qtd_interacoes,qualificado,atendimento_humano",
        )
        .eq("id_empresa", data.companyId)
        .gte("created_at", `${data.dateFrom}T00:00:00-03:00`)
        .lt("created_at", `${nextDay(data.dateTo)}T00:00:00-03:00`)
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (error) throw error;
      leads.push(...(page ?? []));
      if (!page || page.length < 1000) break;
      if (leads.length >= 20000)
        throw new Error("Período muito amplo. Selecione um intervalo menor.");
    }
    if (!leads.length) return [];

    const [projectsResult, stagesResult] = await Promise.all([
      supabaseAdmin.from("empreendimento").select("id,nome").eq("id_empresa", data.companyId),
      supabaseAdmin.from("crm_stages").select("id,nome").eq("id_empresa", data.companyId),
    ]);
    for (const result of [projectsResult, stagesResult]) if (result.error) throw result.error;

    const blocks: Array<{ numero: string | null; motivo_bloqueio: string | null }> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: page, error } = await supabaseAdmin
        .from("blocked_numbers")
        .select("numero,motivo_bloqueio")
        .eq("id_empresa", data.companyId)
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (error) throw error;
      blocks.push(...(page ?? []));
      if (!page || page.length < 1000) break;
    }

    const appointments: Array<{
      id_lead: number | null;
      day: string | null;
      deleted_at: string | null;
    }> = [];
    const dispatches: Array<{
      lead_id: number;
      step_id: number;
      status: string;
      sent_to_meta_at: string | null;
    }> = [];
    for (const group of chunks(leads.map((lead) => lead.id))) {
      const [visits, followups] = await Promise.all([
        supabaseAdmin
          .from("agendamento")
          .select("id_lead,day,deleted_at")
          .eq("id_empresa", data.companyId)
          .in("id_lead", group),
        supabaseAdmin
          .from("followup_dispatches_v2")
          .select("lead_id,step_id,status,sent_to_meta_at")
          .eq("id_empresa", data.companyId)
          .eq("dry_run", false)
          .in("lead_id", group),
      ]);
      if (visits.error) throw visits.error;
      if (followups.error) throw followups.error;
      appointments.push(...(visits.data ?? []));
      dispatches.push(...(followups.data ?? []));
    }

    const stepIds = [...new Set(dispatches.map((dispatch) => dispatch.step_id))];
    const steps = stepIds.length
      ? await supabaseAdmin.from("followup_steps_v2").select("id,nome,step_order").in("id", stepIds)
      : { data: [], error: null };
    if (steps.error) throw steps.error;

    const projectById = new Map(
      (projectsResult.data ?? []).map((project) => [project.id, project.nome]),
    );
    const stageById = new Map((stagesResult.data ?? []).map((stage) => [stage.id, stage.nome]));
    const stepById = new Map(
      (steps.data ?? []).map((step) => [step.id, step.nome || `Follow-up ${step.step_order}`]),
    );
    const blockByNumber = new Map(
      blocks.map((block) => [digits(block.numero), block.motivo_bloqueio]),
    );
    const visitsByLead = new Map<number, typeof appointments>();
    for (const appointment of appointments) {
      if (appointment.id_lead == null) continue;
      const values = visitsByLead.get(appointment.id_lead) ?? [];
      values.push(appointment);
      visitsByLead.set(appointment.id_lead, values);
    }
    const followupsByLead = new Map<number, Set<string>>();
    for (const dispatch of dispatches) {
      if (!dispatch.sent_to_meta_at && !["read", "delivered", "sent"].includes(dispatch.status))
        continue;
      const values = followupsByLead.get(dispatch.lead_id) ?? new Set<string>();
      values.add(stepById.get(dispatch.step_id) ?? `Follow-up ${dispatch.step_id}`);
      followupsByLead.set(dispatch.lead_id, values);
    }

    return leads.map((lead) => {
      const tags = historyTags(lead.status_history);
      const number = digits(lead.numero);
      const invalidNumber = number.length < 10 || number.length > 13;
      const historyBlocked = tags.some((tag) =>
        /bloqueio\s*ia|sem\s*whats|sem\s*telefone/i.test(tag),
      );
      const blockedNumber = blockByNumber.get(number);
      const visits = visitsByLead.get(lead.id) ?? [];
      const activeVisits = visits.filter((visit) => !visit.deleted_at);
      const stage =
        (lead.crm_stage_id == null ? null : stageById.get(lead.crm_stage_id)) ??
        lead.status ??
        "Sem estágio informado";
      const followups = new Set(followupsByLead.get(lead.id) ?? []);
      for (const tag of tags)
        if (/^(fup\s*\d+|follow[ -]?up\s*\d+)$/i.test(tag)) followups.add(tag);
      return {
        id: lead.id,
        crmId: lead.id_crm,
        nome: lead.nome,
        numero: lead.numero,
        createdAt: lead.created_at,
        empreendimentoId: lead.id_empreendimento,
        empreendimento:
          lead.id_empreendimento == null
            ? "Sem empreendimento"
            : (projectById.get(lead.id_empreendimento) ?? "Empreendimento não encontrado"),
        stage,
        status: lead.status,
        interactions: lead.qtd_interacoes ?? 0,
        qualification:
          lead.qualificado === 1
            ? "qualified"
            : lead.qualificado === 2
              ? "disqualified"
              : "pending",
        human: lead.atendimento_humano === true || /atendimento humano/i.test(lead.status ?? ""),
        blocked: invalidNumber || historyBlocked || blockByNumber.has(number),
        blockReason: invalidNumber
          ? "Telefone ausente ou inválido"
          : historyBlocked
            ? "Bloqueio IA registrado"
            : (blockedNumber ?? (blockByNumber.has(number) ? "Número bloqueado" : null)),
        lost: /perdid|lost/i.test(stage),
        visit: activeVisits.length ? "active" : visits.length ? "cancelled" : "none",
        visitDays: activeVisits.flatMap((visit) => (visit.day ? [visit.day] : [])).sort(),
        followups: [...followups].sort(),
      };
    });
  });

