import type { SupabaseClient } from "@supabase/supabase-js";

// Row-level lead actions ported from the current HUB listing; the server (RLS/RPC) remains the authority.
export type Role = "super_admin" | "manager" | "agent" | "analyst";
export type AiStatus = "active" | "paused" | "none";
export type CrmSentState = "sent" | "not_sent" | "unknown";

export function rowPermissions(role: Role | null | undefined, aiStatus: AiStatus, crmSent: CrmSentState) {
  const admin = role === "super_admin";
  const manages = admin || role === "manager";
  return {
    canPauseAi: manages && aiStatus === "active",
    showPausedBadge: aiStatus === "paused",
    canStartAi: admin && aiStatus === "none",
    canDelete: manages,
    canChangeStageOrOwner: admin,
    canSendCrm: manages && crmSent === "not_sent",
  };
}

type Activity = { lead_id: number; tipo?: string | null; descricao?: string | null; metadata?: any };
// Same success criterion as the current HUB: only a crm_export confirming the send counts.
export function isCrmExportSuccess(a: Activity) {
  return (
    a?.tipo === "crm_export" &&
    (a?.metadata?.event === "external_crm_sent" ||
      String(a?.descricao ?? "").toLowerCase().includes("lead enviado ao crm cv com sucesso"))
  );
}

export const CRM_EXPORT_PAGE = 500;

// Owner/stage bulk changes are super_admin only; enforced in the handler, not just hidden.
export function assertBulkAllowed(action: string, canAssign: boolean) {
  if (action === "tag_add" || action === "tag_remove") throw new Error("Tags IA são aplicadas pelas automações. Use tags comerciais nas oportunidades.");
  if ((action === "owner" || action === "stage") && !canAssign) {
    throw new Error("Somente superadministradores podem alterar estágio ou responsável em lote.");
  }
}

export async function fetchCrmSentIds(client: SupabaseClient, leadIds: number[]): Promise<number[]> {
  const ids = [...new Set(leadIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
  const sent = new Set<number>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    // Paginate so the server's max-rows cap never truncates evidence.
    for (let from = 0; ; from += CRM_EXPORT_PAGE) {
      const { data, error } = await client
        .from("crm_lead_activities")
        .select("id,lead_id,tipo,descricao,metadata")
        .eq("tipo", "crm_export")
        .in("lead_id", chunk)
        .order("id", { ascending: true })
        .range(from, from + CRM_EXPORT_PAGE - 1);
      if (error) throw error;
      const page = (data ?? []) as Activity[];
      for (const a of page) if (isCrmExportSuccess(a)) sent.add(Number(a.lead_id));
      if (page.length < CRM_EXPORT_PAGE) break;
    }
  }
  return [...sent];
}

export async function pauseAiAttendance(client: SupabaseClient, leadId: number) {
  const { error } = await client.rpc("crm_pause_ai_attendance", { p_lead_id: leadId });
  if (error) throw error;
}

export async function startAiAttendance(
  client: SupabaseClient,
  { leadId, companyId, actorId }: { leadId: number; companyId: number; actorId: string | null },
) {
  const { data: lead, error: leadError } = await client
    .from("crm_leads")
    .select("id, id_empresa, id_empreendimento")
    .eq("id", leadId)
    .eq("id_empresa", companyId)
    .single();
  if (leadError) throw leadError;
  if (!lead.id_empreendimento) {
    throw new Error("Defina o empreendimento de interesse antes de enviar este lead para atendimento da IA.");
  }
  const [auto, queue] = await Promise.all([
    client.from("lead").select("id").eq("id_crm", String(lead.id)).eq("id_empresa", lead.id_empresa).limit(1),
    client.from("fila_leads").select("id").eq("id_lead", String(lead.id)).eq("id_empresa", lead.id_empresa).limit(1),
  ]);
  if (auto.error) throw auto.error;
  if (queue.error) throw queue.error;
  if ((auto.data?.length ?? 0) > 0 || (queue.data?.length ?? 0) > 0) {
    throw new Error("Este lead já está na fila ou em atendimento da IA.");
  }
  const { error: insertError } = await client.from("fila_leads").insert({
    id_lead: String(lead.id),
    crm_provider: "Hub",
    id_empresa: lead.id_empresa,
    id_empreendimento: lead.id_empreendimento,
    verificado: 0,
    status: "pending",
  });
  if (insertError) throw insertError;
  if (actorId) {
    const { error } = await client.from("crm_lead_activities").insert({
      lead_id: lead.id,
      crm_user_id: actorId,
      tipo: "whatsapp_automation",
      descricao: "Atendimento da IA iniciado manualmente.\nLead enviado para a fila de atendimento.",
      metadata: { source: "crm", event: "ai_service_started_manually", id_empreendimento: lead.id_empreendimento },
    });
    if (error) throw error;
  }
}

// Same delete used by the lead page; RLS decides. Zero affected rows means the server refused.
export async function deleteLead(client: SupabaseClient, companyId: number, leadId: number) {
  const { data, error } = await client.from("crm_leads").delete().eq("id", leadId).eq("id_empresa", companyId).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("O servidor não permitiu excluir este lead com o seu perfil.");
}

