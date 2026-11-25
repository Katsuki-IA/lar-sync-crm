import { db, one, type Contact, type Funnel, type Opportunity, type Stage } from "./modules";

export async function readPages<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await query(from, from + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 500) return rows;
  }
}

export async function loadFunnels(companyId: number, unified: boolean) {
  const modules = unified ? ["ia", "crm"] : ["crm"];
  const [funnels, stages] = await Promise.all([
    db
      .from("crm_funnels")
      .select("id,id_empresa,nome,module,is_default")
      .eq("id_empresa", companyId)
      .in("module", modules)
      .eq("ativo", true)
      .order("ordem")
      .order("id"),
    db
      .from("crm_stages")
      .select("id,id_funnel,nome,cor,ordem")
      .eq("id_empresa", companyId)
      .in("module", modules)
      .eq("ativo", true)
      .order("ordem")
      .order("id"),
  ]);
  if (funnels.error) throw funnels.error;
  if (stages.error) throw stages.error;
  const active = funnels.data as Funnel[];
  return {
    funnels: active,
    stages: (stages.data as Stage[]).filter((s) => active.some((f) => f.id === s.id_funnel)),
  };
}

export function attendanceStage(stageId: number | null, funnels: Funnel[], stages: Stage[]) {
  const ia = funnels.filter((f) => f.module === "ia");
  const defaultId = (ia.find((f) => f.is_default) ?? ia[0])?.id;
  return stageId == null
    ? stages.find((s) => s.id_funnel === defaultId)
    : stages.find((s) => s.id === stageId && ia.some((f) => f.id === s.id_funnel));
}

export async function moveLead(
  companyId: number,
  contact: Contact,
  destination: Stage,
  funnel: Funnel,
  actorId: string,
  previousName?: string,
) {
  if (funnel.module === "ia") {
    let update = db
      .from("crm_leads")
      .update({ crm_stage_id: destination.id })
      .eq("id_empresa", companyId)
      .eq("id", contact.id);
    update =
      contact.crm_stage_id == null
        ? update.is("crm_stage_id", null)
        : update.eq("crm_stage_id", contact.crm_stage_id);
    const result = await update.select("id").single();
    if (result.error) throw result.error;
    const history = await db
      .from("crm_lead_activities")
      .insert({
        lead_id: contact.id,
        crm_user_id: actorId,
        tipo: "stage_change",
        descricao: `De ${previousName ?? "Sem etapa"} para ${destination.nome}`,
      });
    if (history.error) throw new Error("Etapa atualizada. Falha ao registrar o histórico.");
    return;
  }
  const created = await db.rpc("hub_create_opportunity", {
    p_company_id: companyId,
    p_lead_id: contact.id,
    p_funnel_id: funnel.id,
    p_assigned_to: contact.crm_assigned_to,
    p_title: contact.nome?.trim() || `Lead #${contact.id}`,
    p_request_id: crypto.randomUUID(),
  });
  if (created.error) throw created.error;
  const op = one<Opportunity>(created.data);
  if (op.stage_id === destination.id) return;
  const moved = await db.rpc("hub_move_opportunity", {
    p_id: op.id,
    p_stage_id: destination.id,
    p_expected_version: op.version,
  });
  if (moved.error)
    throw new Error("Oportunidade criada. Confira a etapa em Vendas e tente mover novamente.");
}
