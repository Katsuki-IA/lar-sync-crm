export type ConversationOpportunity = { id: string; lead_id: number; stage_id: number | null; funnel_id: number };
export type ConversationTask = { id: string; lead_id: number; status: string; prazo: string | null };
export type ConversationCommercialData = {
 opportunities: ConversationOpportunity[];
 tasks: ConversationTask[];
 stages: { id: number; nome: string }[];
 funnels: { id: number; nome: string }[];
};
export function summarizeConversationLead(data: ConversationCommercialData, leadId: number, now = Date.now()) {
 const opportunities = data.opportunities.filter(o => o.lead_id === leadId);
 const stages = opportunities.map(o => {
  const stage = data.stages.find(s => s.id === o.stage_id)?.nome ?? "Sem estágio";
  const funnel = data.funnels.find(f => f.id === o.funnel_id)?.nome ?? "Funil comercial";
  return { id: o.id, label: opportunities.length > 1 ? funnel + ": " + stage : stage };
 });
 const tasks = data.tasks.filter(t => t.lead_id === leadId);
 const pending = tasks.filter(t => ["pendente", "em_andamento", "vencida"].includes(t.status));
 const overdue = pending.filter(t => t.status === "vencida" || (t.prazo && new Date(t.prazo).getTime() < now));
 return { stages, totalTasks: tasks.length, pendingTasks: pending.length, overdueTasks: overdue.length };
}
