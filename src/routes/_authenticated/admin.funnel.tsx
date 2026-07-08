import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderKanban, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { listEmpresas } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin/funnel")({ component: GlobalFunnelPage });

type GlobalStage = { id: number; nome: string; ordem: number; ativo: boolean };
type Empresa = { id: number; nome: string | null; created_at?: string | null; total_usuarios?: number };
type LocalStage = { id: number; global_stage_id: number | null; nome: string };
const db = supabase as any;

function GlobalFunnelPage() {
  const qc = useQueryClient();
  const listEmpresasFn = useServerFn(listEmpresas);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [ordered, setOrdered] = useState<GlobalStage[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GlobalStage | null>(null);
  const [name, setName] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");

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

  const { data: companies = [] } = useQuery({
    queryKey: ["admin_empresas"],
    queryFn: () => listEmpresasFn(),
  });

  const { data: localStages = [] } = useQuery({
    queryKey: ["crm-company-stage-map", selectedCompanyId],
    enabled: !!selectedCompanyId,
    queryFn: async () => {
      const { data: result, error } = await db
        .from("crm_stages")
        .select("id,global_stage_id,nome")
        .eq("id_empresa", Number(selectedCompanyId))
        .order("ordem");
      if (error) throw error;
      return (result ?? []) as LocalStage[];
    },
  });

  useEffect(() => setOrdered(data?.stages ?? []), [data?.stages]);
  useEffect(() => {
    if (!selectedCompanyId && companies.length) {
      setSelectedCompanyId(String(companies[0].id));
    }
  }, [companies, selectedCompanyId]);

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["crm-global-funnel"] }),
    qc.invalidateQueries({ queryKey: ["crm-funnels"] }),
    qc.invalidateQueries({ queryKey: ["crm_stages"] }),
    qc.invalidateQueries({ queryKey: ["kanban-stages"] }),
    qc.invalidateQueries({ queryKey: ["leads-meta"] }),
    qc.invalidateQueries({ queryKey: ["crm-company-stage-map"] }),
  ]);

  const localStageMap = new Map<number, LocalStage>();
  for (const stage of localStages) {
    if (stage.global_stage_id != null) {
      localStageMap.set(stage.global_stage_id, stage);
    }
  }

  const selectedCompanyName =
    companies.find((company: Empresa) => String(company.id) === selectedCompanyId)?.nome ?? null;

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
      <div className="mb-4 grid gap-3 md:grid-cols-[320px_1fr] md:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="admin-stage-company">Empresa para ver ID local</Label>
          <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
            <SelectTrigger id="admin-stage-company" className="bg-white">
              <SelectValue placeholder="Selecionar empresa" />
            </SelectTrigger>
            <SelectContent>
              {companies.map((company: Empresa) => (
                <SelectItem key={company.id} value={String(company.id)}>
                  {company.nome ?? `Empresa ${company.id}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">
          Os IDs mostrados na listagem são globais. Para SQL e automações por empresa, use o ID local exibido para{" "}
          <span className="font-medium text-foreground">
            {selectedCompanyName ?? "a empresa selecionada"}
          </span>.
        </p>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ordered.map((stage) => stage.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {ordered.map((stage) => (
                <StageRow
                  key={stage.id}
                  stage={stage}
                  localStage={localStageMap.get(stage.id)}
                  selectedCompanyId={selectedCompanyId}
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

function StageRow({
  stage,
  localStage,
  selectedCompanyId,
  disabled,
  onEdit,
  onDelete,
}: {
  stage: GlobalStage;
  localStage?: LocalStage;
  selectedCompanyId: string;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const sortable = useSortable({ id: stage.id, disabled });
  return (
    <div ref={sortable.setNodeRef} className="flex items-center gap-3 rounded-lg border bg-card p-3" style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition, opacity: sortable.isDragging ? 0.65 : 1 }}>
      <button ref={sortable.setActivatorNodeRef} type="button" className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing" {...sortable.attributes} {...sortable.listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="w-28 space-y-1 text-xs text-muted-foreground">
        <div className="font-mono">Global #{stage.id}</div>
        {selectedCompanyId ? (
          <div className="font-mono">
            Local {localStage ? `#${localStage.id}` : "—"}
          </div>
        ) : null}
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium">{stage.nome}</div>
        {selectedCompanyId ? (
          <div className="text-xs text-muted-foreground">
            {localStage ? `ID usado pela empresa selecionada.` : "Etapa local ainda não sincronizada para esta empresa."}
          </div>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground">Ordem {stage.ordem}</span>
      <Button size="icon" variant="ghost" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
    </div>
  );
}
