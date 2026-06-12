import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { Badge } from "@/components/ui/badge";
import { stageColor } from "@/lib/lead-visuals";

type LeadCard = {
  id: number;
  nome: string | null;
  numero: string | null;
  crm_stage_id: number | null;
  crm_assigned_to: string | null;
  id_empreendimento: number | null;
  lead_quente: boolean | null;
  empreendimento_nome?: string | null;
  responsavel_nome?: string | null;
  tags?: { id: number; nome: string; cor: string | null }[];
};

export function KanbanView({ searchFilter }: { searchFilter?: string }) {
  const { data: me } = useCrmUser();
  const { data: allowed } = useAllowedEmpresas();
  const qc = useQueryClient();

  const { data: stages } = useQuery({
    enabled: !!me,
    queryKey: ["kanban-stages", me?.id_empresa],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_stages")
        .select("id, nome, cor, ordem")
        .eq("ativo", true)
        .order("ordem");
      if (error) throw error;
      return data;
    },
  });

  const { data: leads } = useQuery({
    enabled: !!me && !!allowed,
    queryKey: ["kanban-leads", me?.id, me?.role, allowed],
    queryFn: async (): Promise<LeadCard[]> => {
      let q = supabase
        .from("lead")
        .select("id, nome, numero, crm_stage_id, crm_assigned_to, id_empreendimento, lead_quente")
        .in("id_empresa", allowed ?? []);
      if (me?.role === "agent") q = q.eq("crm_assigned_to", me.id);
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
      }));
    },
  });

  const moveMut = useMutation({
    mutationFn: async ({ leadId, fromStageId, toStageId }: { leadId: number; fromStageId: number | null; toStageId: number }) => {
      const fromName = stages?.find((s) => s.id === fromStageId)?.nome ?? "—";
      const toName = stages?.find((s) => s.id === toStageId)?.nome ?? "—";
      const { error } = await supabase.from("lead").update({ crm_stage_id: toStageId }).eq("id", leadId);
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
          (l.numero?.toLowerCase().includes(searchFilter.toLowerCase()) ?? false)
      )
    : (leads ?? []);

  return (
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
        <Link
          to="/leads/$id"
          params={{ id: String(lead.id) }}
          className="text-sm font-semibold text-foreground hover:text-primary truncate"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {lead.nome ?? "Sem nome"}
        </Link>
        {lead.lead_quente && <Flame className="h-4 w-4 text-primary shrink-0" />}
      </div>
      {lead.numero && <div className="text-xs text-muted-foreground mt-0.5">{lead.numero}</div>}
      {lead.empreendimento_nome && (
        <div className="text-xs text-muted-foreground mt-1 truncate">📍 {lead.empreendimento_nome}</div>
      )}
      {lead.responsavel_nome && (
        <div className="flex items-center gap-1.5 mt-2">
          <Avatar className="h-5 w-5">
            <AvatarFallback
              className="text-[8px] font-semibold text-white"
              style={{ backgroundColor: colorFromString(lead.responsavel_nome) }}
            >
              {getInitials(lead.responsavel_nome)}
            </AvatarFallback>
          </Avatar>
          <span className="text-xs text-muted-foreground truncate">{lead.responsavel_nome}</span>
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
    </div>
  );
}
