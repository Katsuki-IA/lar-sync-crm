import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, GripVertical, FolderKanban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useFunnels } from "@/hooks/use-funnels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/settings/stages")({
  component: StagesPage,
});

type Stage = { id: number; nome: string; ordem: number; ativo: boolean; id_funnel: number | null };
const EMPTY_STAGES: Stage[] = [];

function StagesPage() {
  const qc = useQueryClient();
  const { data: me } = useCrmUser();
  const { data: funnels = [] } = useFunnels(me?.id_empresa);
  const [selectedFunnel, setSelectedFunnel] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (selectedFunnel == null && funnels.length) {
      const def = funnels.find((f) => f.is_default) ?? funnels[0];
      setSelectedFunnel(def.id);
    }
  }, [funnels, selectedFunnel]);

  const { data: stages = EMPTY_STAGES, isLoading } = useQuery({
    enabled: selectedFunnel != null,
    queryKey: ["crm_stages", selectedFunnel],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_stages")
        .select("id,nome,ordem,ativo,id_funnel")
        .eq("id_funnel", selectedFunnel!)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return data as Stage[];
    },
  });

  const [editing, setEditing] = useState<Stage | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nome: "" });
  const [orderedStages, setOrderedStages] = useState<Stage[]>([]);

  useEffect(() => {
    setOrderedStages(stages);
  }, [stages]);

  // New-funnel dialog
  const [funnelOpen, setFunnelOpen] = useState(false);
  const [funnelName, setFunnelName] = useState("");

  const createFunnel = useMutation({
    mutationFn: async () => {
      if (!me?.id_empresa) throw new Error("Empresa não encontrada");
      if (!funnelName.trim()) throw new Error("Informe um nome");
      const maxOrdem = Math.max(0, ...funnels.map((f) => f.ordem));
      const { data, error } = await supabase
        .from("crm_funnels")
        .insert({ id_empresa: me.id_empresa, nome: funnelName.trim(), ordem: maxOrdem + 1 })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as number;
    },
    onSuccess: (id) => {
      toast.success("Funil criado");
      qc.invalidateQueries({ queryKey: ["crm-funnels"] });
      setFunnelOpen(false);
      setFunnelName("");
      setSelectedFunnel(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameFunnel = useMutation({
    mutationFn: async (nome: string) => {
      if (!selectedFunnel) return;
      const { error } = await supabase.from("crm_funnels").update({ nome }).eq("id", selectedFunnel);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Funil renomeado");
      qc.invalidateQueries({ queryKey: ["crm-funnels"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteFunnel = useMutation({
    mutationFn: async () => {
      if (!selectedFunnel) return;
      const f = funnels.find((x) => x.id === selectedFunnel);
      if (f?.is_default) throw new Error("Não é possível excluir o funil padrão");
      const { error } = await supabase.from("crm_funnels").delete().eq("id", selectedFunnel);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Funil removido");
      const def = funnels.find((f) => f.is_default);
      setSelectedFunnel(def?.id ?? null);
      qc.invalidateQueries({ queryKey: ["crm-funnels"] });
      qc.invalidateQueries({ queryKey: ["crm_stages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const currentFunnel = useMemo(() => funnels.find((f) => f.id === selectedFunnel) ?? null, [funnels, selectedFunnel]);

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        const { error } = await supabase
          .from("crm_stages")
          .update({ nome: form.nome })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        if (!selectedFunnel) throw new Error("Selecione um funil");
        const maxOrdem = Math.max(0, ...stages.map((s) => s.ordem));
        if (!me?.id_empresa) throw new Error("Empresa não encontrada");
        const { error } = await supabase.from("crm_stages").insert({
          nome: form.nome,
          ordem: maxOrdem + 1,
          ativo: true,
          id_empresa: me.id_empresa,
          id_funnel: selectedFunnel,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Etapa atualizada" : "Etapa criada");
      qc.invalidateQueries({ queryKey: ["crm_stages"] });
      setOpen(false);
      setEditing(null);
      setForm({ nome: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("crm_stages").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Etapa removida");
      qc.invalidateQueries({ queryKey: ["crm_stages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorder = useMutation({
    mutationFn: async (nextStages: Stage[]) => {
      if (!selectedFunnel || !me?.id_empresa) throw new Error("Funil não encontrado");
      for (const [index, stage] of nextStages.entries()) {
        const { error } = await supabase
          .from("crm_stages")
          .update({ ordem: index + 1 })
          .eq("id", stage.id)
          .eq("id_funnel", selectedFunnel)
          .eq("id_empresa", me.id_empresa);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      toast.success("Ordem das etapas atualizada");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["crm_stages"] }),
        qc.invalidateQueries({ queryKey: ["kanban-stages"] }),
        qc.invalidateQueries({ queryKey: ["leads-meta"] }),
      ]);
    },
    onError: async (e: Error) => {
      setOrderedStages(stages);
      await qc.invalidateQueries({ queryKey: ["crm_stages"] });
      toast.error(e.message);
    },
  });

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || reorder.isPending) return;
    const oldIndex = orderedStages.findIndex((stage) => stage.id === active.id);
    const newIndex = orderedStages.findIndex((stage) => stage.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const nextStages = arrayMove(orderedStages, oldIndex, newIndex).map((stage, index) => ({
      ...stage,
      ordem: index + 1,
    }));
    setOrderedStages(nextStages);
    reorder.mutate(nextStages);
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-medium flex items-center gap-2">
            <FolderKanban className="h-4 w-4" /> Funis e etapas
          </h2>
          <Select value={selectedFunnel ? String(selectedFunnel) : ""} onValueChange={(v) => setSelectedFunnel(Number(v))}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Selecione um funil" /></SelectTrigger>
            <SelectContent>
              {funnels.map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>
                  {f.nome}{f.is_default ? " (padrão)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {currentFunnel && (
            <>
              <Button size="sm" variant="ghost" onClick={() => {
                const novo = prompt("Renomear funil", currentFunnel.nome);
                if (novo && novo.trim() && novo !== currentFunnel.nome) renameFunnel.mutate(novo.trim());
              }}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {!currentFunnel.is_default && (
                <Button size="sm" variant="ghost" onClick={() => {
                  if (confirm(`Remover o funil "${currentFunnel.nome}" e todos os seus estágios?`)) deleteFunnel.mutate();
                }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={funnelOpen} onOpenChange={setFunnelOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-1" />Novo funil
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo funil</DialogTitle></DialogHeader>
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={funnelName} onChange={(e) => setFunnelName(e.target.value)} placeholder="Ex.: Pós-venda" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setFunnelOpen(false)}>Cancelar</Button>
                <Button onClick={() => createFunnel.mutate()} disabled={!funnelName.trim() || createFunnel.isPending}>Criar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditing(null); setForm({ nome: "" }); }} disabled={!selectedFunnel}>
              <Plus className="h-4 w-4 mr-2" />Nova etapa
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Editar etapa" : "Nova etapa"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Qualificado" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={() => save.mutate()} disabled={!form.nome || save.isPending}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : stages.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhuma etapa cadastrada.</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={orderedStages.map((stage) => stage.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {orderedStages.map((stage) => (
                <SortableStageRow
                  key={stage.id}
                  stage={stage}
                  disabled={reorder.isPending}
                  onEdit={() => {
                    setEditing(stage);
                    setForm({ nome: stage.nome });
                    setOpen(true);
                  }}
                  onDelete={() => {
                    if (confirm(`Remover etapa "${stage.nome}"?`)) del.mutate(stage.id);
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </Card>
  );
}

function SortableStageRow({
  stage,
  disabled,
  onEdit,
  onDelete,
}: {
  stage: Stage;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id, disabled });

  return (
    <div
      ref={setNodeRef}
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.65 : 1,
        position: "relative",
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="touch-none cursor-grab rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed"
        title="Arrastar para reordenar"
        aria-label={`Reordenar etapa ${stage.nome}`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-6 font-mono text-xs text-muted-foreground">{stage.id}</span>
      <div className="flex-1 text-sm font-medium">{stage.nome}</div>
      <span className="text-xs text-muted-foreground">Ordem {stage.ordem}</span>
      <Button size="icon" variant="ghost" onClick={onEdit} aria-label={`Editar ${stage.nome}`}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="ghost" onClick={onDelete} aria-label={`Excluir ${stage.nome}`}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
