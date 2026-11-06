import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, ListFilter } from "lucide-react";
import { db, useCompanyModules } from "@/hml/modules";
import { Badge } from "@/components/ui/badge";
import { summarizeConversationLead, type ConversationCommercialData } from "@/lib/conversation-commercial-summary";

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
 const enabled = !!companyId && !!userId && !!modules.data?.crm && ids.length > 0;
 const query = useQuery({
  queryKey: ["conversation-commercial-summary", companyId, userId, ids],
  enabled, staleTime: 15_000, refetchInterval: 30_000,
  queryFn: async (): Promise<ConversationCommercialData> => {
   const [opportunities, tasks, stages, funnels] = await Promise.all([
    readPages((from, to) => db.from("crm_opportunities").select("id,lead_id,stage_id,funnel_id")
     .eq("id_empresa", companyId!).in("lead_id", ids).order("id").range(from, to)),
    readPages((from, to) => db.from("crm_lead_tasks").select("id,lead_id,status,prazo")
     .eq("id_empresa", companyId!).in("lead_id", ids).order("id").range(from, to)),
    readPages((from, to) => db.from("crm_stages").select("id,nome").eq("id_empresa", companyId!).eq("module", "crm").order("id").range(from, to)),
    readPages((from, to) => db.from("crm_funnels").select("id,nome").eq("id_empresa", companyId!).eq("module", "crm").order("id").range(from, to)),
   ]);
   return { opportunities, tasks, stages, funnels };
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
   className="max-w-full gap-1 whitespace-normal break-words text-left font-normal">
   <ListFilter className="h-3 w-3 shrink-0" aria-hidden="true" />
   <span className="min-w-0">CRM: {stage.label}</span>
  </Badge>) : <Badge variant="outline" className="font-normal text-muted-foreground">Sem oportunidade</Badge>}
  <Badge variant="outline" className={"max-w-full gap-1 whitespace-normal text-left font-normal " + (info.overdueTasks ? "border-destructive/40 text-destructive" : "text-muted-foreground")}>
   <CalendarCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
   {info.pendingTasks
    ? info.pendingTasks + (info.pendingTasks === 1 ? " tarefa pendente" : " tarefas pendentes") + (info.overdueTasks ? " · " + info.overdueTasks + (info.overdueTasks === 1 ? " vencida" : " vencidas") : "")
    : info.totalTasks ? info.totalTasks + (info.totalTasks === 1 ? " tarefa · encerrada" : " tarefas · encerradas") : "Sem tarefas"}
  </Badge>
 </div>;
}
