import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderKanban, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin/funnel")({ component: GlobalFunnelPage });

type GlobalStage = { id: number; nome: string; ordem: number; ativo: boolean };
const db = supabase as any;

function GlobalFunnelPage() {
  const qc = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [ordered, setOrdered] = useState<GlobalStage[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GlobalStage | null>(null);
  const [name, setName] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["crm-global-funnel"],
    queryFn: async () => {
      const [funnelResult, stagesResult] = await Promise.all([
        db.from("crm_global_funnel").select("id,nome").eq("id", 1).single(),
        db.from("crm_global_stages").select("id,nome,ordem,ativo").order("ordem"),
      ]);
      if (funnelResult.error) throw funnelResult.error;
      if (stagesResult.error) throw stagesResult.error;
      return { funnel: funnelResult.data as { id: number; nome: string }, stages: stagesResult.data as GlobalStage[] };
    },
  });

  useEffect(() => setOrdered(data?.stages ?? []), [data?.stages]);

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["crm-global-funnel"] }),
    qc.invalidateQueries({ queryKey: ["crm-funnels"] }),
    qc.invalidateQueries({ queryKey: ["crm_stages"] }),
    qc.invalidateQueries({ queryKey: ["kanban-stages"] }),
    qc.invalidateQueries({ queryKey: ["leads-meta"] }),
  ]);

  const renameFunnel = useMutation({
    mutationFn: async () => {
      const next = prompt("Nome do funil global", data?.funnel.nome ?? "Funil padrão")?.trim();
      if (!next || next === data?.funnel.nome) return false;
      const { error } = await db.rpc("crm_global_funnel_rename", { p_nome: next });
      if (error) throw error;
      return true;
    },
    onSuccess: async (changed) => { if (changed) { toast.success("Funil atualizado em todas as empresas"); await refresh(); } },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveStage = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Informe o nome da etapa");
      const result = editing
        ? await db.rpc("crm_global_stage_update", { p_id: editing.id, p_nome: trimmed })
        : await db.rpc("crm_global_stage_create", { p_nome: trimmed });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      toast.success(editing ? "Etapa atualizada em todas as empresas" : "Etapa criada em todas as empresas");
      setDialogOpen(false);
      setEditing(null);
      setName("");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteStage = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await db.rpc("crm_global_stage_delete", { p_id: id });
      if (error) throw error;
    },
    onSuccess: async () => { toast.success("Etapa removida de todas as empresas"); await refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });

  const reorder = useMutation({
    mutationFn: async (stages: GlobalStage[]) => {
      const { error } = await db.rpc("crm_global_stages_reorder", { p_ids: stages.map((stage) => stage.id) });
      if (error) throw error;
    },
    onSuccess: async () => { toast.success("Ordem atualizada em todas as empresas"); await refresh(); },
    onError: async (error: Error) => { setOrdered(data?.stages ?? []); toast.error(error.message); await refresh(); },
  });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || reorder.isPending) return;
    const oldIndex = ordered.findIndex((stage) => stage.id === active.id);
    const newIndex = ordered.findIndex((stage) => stage.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ordered, oldIndex, newIndex).map((stage, index) => ({ ...stage, ordem: index + 1 }));
    setOrdered(next);
    reorder.mutate(next);
  };

  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="flex items-center gap-2 text-lg font-medium"><FolderKanban className="h-4 w-4" />Funil global</h2>
          <span className="text-sm text-muted-foreground">{data?.funnel.nome ?? "Carregando..."}</span>
          <Button size="icon" variant="ghost" onClick={() => renameFunnel.mutate()} title="Renomear funil">
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
        <Button onClick={() => { setEditing(null); setName(""); setDialogOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />Nova etapa
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">As alterações abaixo são aplicadas a todas as empresas e também ao seed de novas empresas.</p>
      {isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ordered.map((stage) => stage.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {ordered.map((stage) => (
                <StageRow
                  key={stage.id}
                  stage={stage}
                  disabled={reorder.isPending}
                  onEdit={() => { setEditing(stage); setName(stage.nome); setDialogOpen(true); }}
                  onDelete={() => { if (confirm(`Remover a etapa "${stage.nome}" de todas as empresas?`)) deleteStage.mutate(stage.id); }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar etapa global" : "Nova etapa global"}</DialogTitle></DialogHeader>
          <div className="space-y-2"><Label>Nome</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveStage.mutate()} disabled={!name.trim() || saveStage.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function StageRow({ stage, disabled, onEdit, onDelete }: { stage: GlobalStage; disabled: boolean; onEdit: () => void; onDelete: () => void }) {
  const sortable = useSortable({ id: stage.id, disabled });
  return (
    <div ref={sortable.setNodeRef} className="flex items-center gap-3 rounded-lg border bg-card p-3" style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition, opacity: sortable.isDragging ? 0.65 : 1 }}>
      <button ref={sortable.setActivatorNodeRef} type="button" className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing" {...sortable.attributes} {...sortable.listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-16 font-mono text-xs text-muted-foreground">ID {stage.id}</span>
      <span className="flex-1 text-sm font-medium">{stage.nome}</span>
      <span className="text-xs text-muted-foreground">Ordem {stage.ordem}</span>
      <Button size="icon" variant="ghost" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
    </div>
  );
}
