import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, ListFilter } from "lucide-react";
import { db, useCompanyModules } from "@/hml/modules";
import { attendanceStage, loadFunnels } from "@/hml/unified-stages";
import { Badge } from "@/components/ui/badge";
import { summarizeConversationLead, taskDateLabel, type ConversationCommercialData } from "@/lib/conversation-commercial-summary";

async function readPages(query: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>) {
 const rows: any[] = [];
 for (let from = 0; ; from += 500) {
  const result = await query(from, from + 499);
  if (result.error) throw result.error;
  rows.push(...(result.data ?? []));
  if ((result.data?.length ?? 0) < 500) return rows;
 }
}
export function useConversationCommercialData(companyId: number | null, userId: string | undefined, leadIds: number[]) {
 const modules = useCompanyModules(companyId ?? undefined);
 const ids = [...new Set(leadIds)].sort((a, b) => a - b);
 const unified = !!(modules.data?.crm && modules.data.atendimento_ia);
 const enabled = !!companyId && !!userId && !!modules.data?.crm;
 const query = useQuery({
  queryKey: ["conversation-commercial-summary", companyId, userId, ids, unified],
  enabled, staleTime: 15_000, refetchInterval: 30_000,
  queryFn: async (): Promise<ConversationCommercialData> => {
   const [opportunities, tasks, stages, funnels, catalog, leads] = await Promise.all([
    ids.length ? readPages((from, to) => db.from("crm_opportunities").select("id,lead_id,stage_id,funnel_id")
     .eq("id_empresa", companyId!).in("lead_id", ids).order("id").range(from, to)) : Promise.resolve([]),
    ids.length ? readPages((from, to) => db.from("crm_lead_tasks").select("id,lead_id,status,prazo")
     .eq("id_empresa", companyId!).in("lead_id", ids).order("id").range(from, to)) : Promise.resolve([]),
    readPages((from, to) => db.from("crm_stages").select("id,nome,cor,id_funnel").eq("id_empresa", companyId!).eq("module", "crm").order("id").range(from, to)),
    readPages((from, to) => db.from("crm_funnels").select("id,nome").eq("id_empresa", companyId!).eq("module", "crm").order("id").range(from, to)),
    unified ? loadFunnels(companyId!,true) : null,
    unified && ids.length ? readPages((from,to) => db.from("crm_leads").select("id,crm_stage_id").eq("id_empresa",companyId!).in("id",ids).order("id").range(from,to)) : [],
   ]);
   const attendance: Record<number,number | null> = {};
   const iaFunnels = catalog?.funnels.filter(f => f.module === "ia") ?? [];
   for (const lead of leads) attendance[lead.id] = catalog ? attendanceStage(lead.crm_stage_id,catalog.funnels,catalog.stages)?.id ?? null : null;
   return { opportunities, tasks, attendance, stages:[...stages,...(catalog?.stages.filter(s => iaFunnels.some(f => f.id === s.id_funnel)) ?? [])], funnels:[...funnels,...iaFunnels] };
  },
 });
 return { ...query, available: !!modules.data?.crm };
}
export function ConversationCommercialSummary({ data, leadId, loading, error }: {
 data?: ConversationCommercialData; leadId: number; loading: boolean; error: boolean;
}) {
 if (error) return <p className="mt-2 text-xs text-muted-foreground">Estágio e tarefas indisponíveis</p>;
 if (loading || !data) return <p className="mt-2 text-xs text-muted-foreground">Carregando estágio e tarefas…</p>;
 const info = summarizeConversationLead(data, leadId);
 return <div className="mt-2 flex min-w-0 flex-wrap gap-1.5" aria-label="Resumo comercial do lead">
  {info.stages.length ? info.stages.map(stage => <Badge key={stage.id} variant="outline"
   className="max-w-full gap-1 whitespace-normal break-words text-left font-medium"
   style={stage.color && /^#[0-9a-f]{6}$/i.test(stage.color) ? {backgroundColor: stage.color + "25", borderColor: stage.color + "60"} : undefined}>
   <ListFilter className="h-3 w-3 shrink-0" aria-hidden="true" />
   <span className="min-w-0">{stage.label}</span>
  </Badge>) : <Badge variant="outline" className="font-normal text-muted-foreground">{info.attendanceLabel ?? "Sem oportunidade"}</Badge>}
  {info.nextTask && <Badge variant="outline" className={"max-w-full gap-1 whitespace-normal text-left font-normal " + (info.overdueTasks ? "border-destructive/40 text-destructive" : "") }>
   <CalendarCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
   Tarefa · {taskDateLabel(info.nextTask.prazo)}{info.pendingTasks > 1 ? ` · +${info.pendingTasks - 1}` : ""}
  </Badge>}
 </div>;
}
