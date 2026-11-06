export type ConversationOpportunity = { id: string; lead_id: number; stage_id: number | null; funnel_id: number };
export type ConversationTask = { id: string; lead_id: number; status: string; prazo: string | null };
export type ConversationCommercialData = {
 opportunities: ConversationOpportunity[];
 tasks: ConversationTask[];
 stages: { id: number; nome: string; cor?: string | null; id_funnel?: number }[];
 funnels: { id: number; nome: string }[];
};
export function summarizeConversationLead(data: ConversationCommercialData, leadId: number, now = Date.now()) {
 const opportunities = data.opportunities.filter(o => o.lead_id === leadId);
 const stages = opportunities.map(o => {
  const definition = data.stages.find(s => s.id === o.stage_id);
  const stage = definition?.nome ?? "Sem estágio";
  const funnel = data.funnels.find(f => f.id === o.funnel_id)?.nome ?? "Funil comercial";
  return { id: o.id, color: definition?.cor, label: opportunities.length > 1 ? funnel + ": " + stage : stage };
 });
 const tasks = data.tasks.filter(t => t.lead_id === leadId);
 const pending = tasks.filter(t => ["pendente", "em_andamento", "vencida"].includes(t.status));
 const overdue = pending.filter(t => t.status === "vencida" || (t.prazo && new Date(t.prazo).getTime() < now));
 const nextTask = [...pending].sort((a,b) => (a.prazo ? Date.parse(a.prazo) : Infinity) - (b.prazo ? Date.parse(b.prazo) : Infinity))[0];
 return { stages, nextTask, totalTasks: tasks.length, pendingTasks: pending.length, overdueTasks: overdue.length };
}

export function matchesCommercialStage(data: ConversationCommercialData, leadId: number | null, filter: string) {
 if (filter === "all") return true;
 const opportunities = data.opportunities.filter(o => o.lead_id === leadId);
 return filter === "none" ? opportunities.length === 0 : opportunities.some(o => String(o.stage_id) === filter);
}
export function taskDateLabel(value: string | null) {
 if (!value) return "Sem data";
 const date = new Date(value);
 if (!Number.isFinite(date.getTime())) return "Sem data";
 return date.toLocaleDateString("pt-BR", {day:"2-digit", month:"2-digit"}) + " às " + date.toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit"});
}
