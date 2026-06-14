import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Building2, Clock } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { Badge } from "@/components/ui/badge";
import { stageColor } from "@/lib/lead-visuals";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.693.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.04 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.999-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.889-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.892 6.994c-.003 5.45-4.437 9.884-9.886 9.884zm8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.49-8.413z"/>
    </svg>
  );
}

type LeadCard = {
  id: number;
  nome: string | null;
  telefone: string | null;
  crm_stage_id: number | null;
  crm_assigned_to: string | null;
  id_empreendimento: number | null;
  lead_quente: boolean | null;
  empreendimento_nome?: string | null;
  responsavel_nome?: string | null;
  tags?: { id: number; nome: string; cor: string | null }[];
  stage_entered_at?: string | null;
};

async function isFunnelDefault(funnelId: number): Promise<boolean> {
  const { data } = await supabase.from("crm_funnels").select("is_default").eq("id", funnelId).maybeSingle();
  return !!data?.is_default;
}

export function KanbanView({ searchFilter, funnelId }: { searchFilter?: string; funnelId?: number | null }) {
  const { data: me } = useCrmUser();
  const { data: allowed } = useAllowedEmpresas();
  const qc = useQueryClient();

  const { data: stages } = useQuery({
    enabled: !!me && funnelId != null,
    queryKey: ["kanban-stages", me?.id_empresa, funnelId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_stages")
        .select("id, nome, cor, ordem, id_funnel")
        .eq("ativo", true)
        .eq("id_funnel", funnelId!)
        .order("ordem");
      if (error) throw error;
      return data;
    },
  });

  const { data: leads } = useQuery({
    enabled: !!me && !!allowed && !!stages,
    queryKey: ["kanban-leads", me?.id, me?.role, allowed, funnelId, (stages ?? []).map((s) => s.id).join(",")],
    queryFn: async (): Promise<LeadCard[]> => {
      const stageIds = (stages ?? []).map((s) => s.id);
      if (!stageIds.length) return [];
      let q = supabase
        .from("crm_leads")
        .select("id, nome, telefone, crm_stage_id, crm_assigned_to, id_empreendimento, lead_quente")
        .in("id_empresa", allowed ?? []);
      if (me?.role === "agent") q = q.eq("crm_assigned_to", me.id);
      // Filtra leads pelo funil: estágios desse funil. Leads sem estágio só aparecem no funil padrão.
      const isDefault = await isFunnelDefault(funnelId!);
      if (isDefault) {
        q = q.or(`crm_stage_id.in.(${stageIds.join(",")}),crm_stage_id.is.null`);
      } else {
        q = q.in("crm_stage_id", stageIds);
      }
      const { data: rows, error } = await q.limit(500);
      if (error) throw error;

      const empIds = [...new Set((rows ?? []).map((l) => l.id_empreendimento).filter(Boolean))] as number[];
      const userIds = [...new Set((rows ?? []).map((l) => l.crm_assigned_to).filter(Boolean))] as string[];
      const leadIds = (rows ?? []).map((l) => l.id);

      const [{ data: emps }, { data: users }, { data: tagLinks }, { data: tags }] = await Promise.all([
        empIds.length ? supabase.from("empreendimento").select("id, nome").in("id", empIds) : Promise.resolve({ data: [] as { id: number; nome: string }[] }),
        userIds.length ? supabase.from("crm_users").select("id, nome").in("id", userIds) : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
        leadIds.length ? supabase.from("crm_lead_tags").select("lead_id, tag_id").in("lead_id", leadIds) : Promise.resolve({ data: [] as { lead_id: number; tag_id: number }[] }),
        supabase.from("crm_tags").select("id, nome, cor"),
      ]);

      // Tempo no estágio: usa a última atividade tipo 'stage_change' por lead; fallback para created_at do lead.
      const { data: stageActs } = leadIds.length
        ? await supabase
            .from("crm_lead_activities")
            .select("lead_id, created_at")
            .eq("tipo", "stage_change")
            .in("lead_id", leadIds)
            .order("created_at", { ascending: false })
        : { data: [] as { lead_id: number; created_at: string | null }[] };
      const stageEnteredMap = new Map<number, string>();
      for (const a of stageActs ?? []) {
        if (a.created_at && !stageEnteredMap.has(a.lead_id)) stageEnteredMap.set(a.lead_id, a.created_at);
      }
      const { data: leadCreated } = leadIds.length
        ? await supabase.from("crm_leads").select("id, created_at").in("id", leadIds)
        : { data: [] as { id: number; created_at: string | null }[] };
      const createdMap = new Map<number, string | null>((leadCreated ?? []).map((l) => [l.id, l.created_at]));

      const empMap = new Map((emps ?? []).map((e) => [e.id, e.nome]));
      const userMap = new Map((users ?? []).map((u) => [u.id, u.nome]));
      const tagMap = new Map((tags ?? []).map((t) => [t.id, t]));
      const tagByLead = new Map<number, { id: number; nome: string; cor: string | null }[]>();
      for (const tl of tagLinks ?? []) {
        const t = tagMap.get(tl.tag_id);
        if (!t) continue;
        const arr = tagByLead.get(tl.lead_id) ?? [];
        arr.push(t);
        tagByLead.set(tl.lead_id, arr);
      }

      return (rows ?? []).map((l) => ({
        ...l,
        empreendimento_nome: l.id_empreendimento ? empMap.get(l.id_empreendimento) ?? null : null,
        responsavel_nome: l.crm_assigned_to ? userMap.get(l.crm_assigned_to) ?? null : null,
        tags: tagByLead.get(l.id) ?? [],
        stage_entered_at: stageEnteredMap.get(l.id) ?? createdMap.get(l.id) ?? null,
      }));
    },
  });

  const moveMut = useMutation({
    mutationFn: async ({ leadId, fromStageId, toStageId }: { leadId: number; fromStageId: number | null; toStageId: number }) => {
      const fromName = stages?.find((s) => s.id === fromStageId)?.nome ?? "—";
      const toName = stages?.find((s) => s.id === toStageId)?.nome ?? "—";
      const { error } = await supabase.from("crm_leads").update({ crm_stage_id: toStageId }).eq("id", leadId);
      if (error) throw error;
      if (me) {
        await supabase.from("crm_lead_activities").insert({
          lead_id: leadId,
          crm_user_id: me.id,
          tipo: "stage_change",
          descricao: `De ${fromName} para ${toName}`,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kanban-leads"] });
      toast.success("Estágio atualizado");
    },
    onError: (e: Error) => toast.error("Erro ao mover", { description: e.message }),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragEnd(ev: DragEndEvent) {
    if (!ev.over) return;
    const leadId = Number(ev.active.id);
    const toStageId = Number(ev.over.id);
    const lead = leads?.find((l) => l.id === leadId);
    if (!lead || lead.crm_stage_id === toStageId) return;
    moveMut.mutate({ leadId, fromStageId: lead.crm_stage_id, toStageId });
  }

  const filteredLeads = searchFilter
    ? (leads ?? []).filter(
        (l) =>
          (l.nome?.toLowerCase().includes(searchFilter.toLowerCase()) ?? false) ||
          (l.telefone?.toLowerCase().includes(searchFilter.toLowerCase()) ?? false)
      )
    : (leads ?? []);

  return (
    <TooltipProvider delayDuration={200}>
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {(stages ?? []).map((stage) => {
          const firstStageId = stages?.[0]?.id;
          const stageLeads = filteredLeads.filter((l) =>
            l.crm_stage_id === stage.id || (l.crm_stage_id == null && stage.id === firstStageId),
          );
          return <KanbanColumn key={stage.id} stage={stage} leads={stageLeads} />;
        })}
      </div>
    </DndContext>
    </TooltipProvider>
  );
}

function KanbanColumn({ stage, leads }: { stage: { id: number; nome: string; cor: string | null }; leads: LeadCard[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const color = stageColor(stage.nome, stage.cor);
  return (
    <div
      ref={setNodeRef}
      className="w-72 shrink-0 rounded-xl border flex flex-col"
      style={{ backgroundColor: "#1A1D27", borderColor: "#2A2D3A" }}
    >
      <div
        className="px-4 py-3 rounded-t-xl flex items-center justify-between border-b"
        style={{ backgroundColor: `${color}1A`, borderColor: `${color}33` }}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="font-semibold text-sm" style={{ color }}>{stage.nome}</span>
        </div>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${color}26`, color }}
        >
          {leads.length}
        </span>
      </div>
      <div className={`p-2 space-y-2 min-h-32 flex-1 transition-colors rounded-b-xl ${isOver ? "bg-primary/5 ring-2 ring-primary/30 ring-inset" : ""}`}>
        {leads.map((l) => (
          <DraggableCard key={l.id} lead={l} color={color} />
        ))}
        {!leads.length && <p className="text-xs text-muted-foreground text-center py-6">Sem leads</p>}
      </div>
    </div>
  );
}

function DraggableCard({ lead, color }: { lead: LeadCard; color: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.6 : 1,
    borderLeft: `3px solid ${color}`,
    boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
    backgroundColor: "#1A1D27",
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="rounded-[10px] border p-3 cursor-grab active:cursor-grabbing transition-transform hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-muted-foreground/80 mb-0.5">#{lead.id}</div>
          <Link
            to="/leads/$id"
            params={{ id: String(lead.id) }}
            className="text-sm font-semibold text-foreground hover:text-primary truncate block"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {lead.nome ?? "Sem nome"}
          </Link>
        </div>
      </div>
      {lead.telefone && (
        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
          <WhatsAppIcon className="h-3.5 w-3.5 text-white shrink-0" />
          <span className="truncate">{lead.telefone}</span>
        </div>
      )}
      {lead.empreendimento_nome && (
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 text-white shrink-0" />
          <span className="truncate">{lead.empreendimento_nome}</span>
        </div>
      )}
      {lead.responsavel_nome && (
        <div className="text-xs text-muted-foreground mt-2 truncate">
          {lead.responsavel_nome}
        </div>
      )}
      {!!lead.tags?.length && (
        <div className="flex flex-wrap gap-1 mt-2">
          {lead.tags.map((t) => (
            <Badge
              key={t.id}
              variant="secondary"
              className="text-[10px] px-1.5 py-0 h-4"
              style={{ backgroundColor: `${t.cor ?? "#f97316"}26`, color: t.cor ?? "#f97316" }}
            >
              {t.nome}
            </Badge>
          ))}
        </div>
      )}
      {lead.stage_entered_at && <StageTime iso={lead.stage_entered_at} />}
    </div>
  );
}

function StageTime({ iso }: { iso: string }) {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(hours / 24);
  const label = days >= 1 ? `${days}d` : `${Math.max(1, hours)}h`;
  let colorClass = "text-muted-foreground";
  if (days >= 3) colorClass = "text-red-400";
  else if (days >= 1) colorClass = "text-yellow-400";
  const exact = date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  return (
    <div className="flex justify-end mt-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 text-[11px] leading-none cursor-default ${colorClass}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Clock className="h-3 w-3" />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent>Entrou neste estágio em {exact}</TooltipContent>
      </Tooltip>
    </div>
  );
}
