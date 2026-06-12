import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, GripVertical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/settings/stages")({
  component: StagesPage,
});

type Stage = { id: number; nome: string; cor: string; ordem: number; ativo: boolean };

function StagesPage() {
  const qc = useQueryClient();
  const { data: stages = [], isLoading } = useQuery({
    queryKey: ["crm_stages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_stages")
        .select("id,nome,cor,ordem,ativo")
        .order("ordem", { ascending: true });
      if (error) throw error;
      return data as Stage[];
    },
  });

  const [editing, setEditing] = useState<Stage | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nome: "", cor: "#F97316" });

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        const { error } = await supabase
          .from("crm_stages")
          .update({ nome: form.nome, cor: form.cor })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const maxOrdem = Math.max(0, ...stages.map((s) => s.ordem));
        const { data: u } = await supabase.auth.getUser();
        const { data: me } = await supabase
          .from("crm_users")
          .select("id_empresa")
          .eq("auth_user_id", u.user!.id)
          .maybeSingle();
        if (!me?.id_empresa) throw new Error("Empresa não encontrada");
        const { error } = await supabase.from("crm_stages").insert({
          nome: form.nome,
          cor: form.cor,
          ordem: maxOrdem + 1,
          ativo: true,
          id_empresa: me.id_empresa,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Etapa atualizada" : "Etapa criada");
      qc.invalidateQueries({ queryKey: ["crm_stages"] });
      setOpen(false);
      setEditing(null);
      setForm({ nome: "", cor: "#F97316" });
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

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium">Etapas do funil</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditing(null); setForm({ nome: "", cor: "#F97316" }); }}>
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
              <div className="space-y-2">
                <Label>Cor</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.cor} onChange={(e) => setForm({ ...form, cor: e.target.value })} className="h-9 w-12 rounded border border-input bg-background" />
                  <Input value={form.cor} onChange={(e) => setForm({ ...form, cor: e.target.value })} className="font-mono" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={() => save.mutate()} disabled={!form.nome || save.isPending}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : stages.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhuma etapa cadastrada.</div>
      ) : (
        <div className="space-y-2">
          {stages.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
              <div className="h-3 w-3 rounded-full" style={{ background: s.cor }} />
              <div className="flex-1 font-medium text-sm">{s.nome}</div>
              <span className="text-xs text-muted-foreground">Ordem {s.ordem}</span>
              <Button size="icon" variant="ghost" onClick={() => { setEditing(s); setForm({ nome: s.nome, cor: s.cor ?? "#F97316" }); setOpen(true); }}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Remover etapa "${s.nome}"?`)) del.mutate(s.id); }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}