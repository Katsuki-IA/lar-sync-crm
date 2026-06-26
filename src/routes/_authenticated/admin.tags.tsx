import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin/tags")({ component: GlobalTagsPage });

type GlobalTag = { id: number; nome: string; cor: string };
const db = supabase as any;

function GlobalTagsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GlobalTag | null>(null);
  const [form, setForm] = useState({ nome: "", cor: "#C14F21" });
  const { data: tags = [], isLoading } = useQuery({
    queryKey: ["crm-global-tags"],
    queryFn: async () => {
      const { data, error } = await db.from("crm_global_tags").select("id,nome,cor").order("nome");
      if (error) throw error;
      return data as GlobalTag[];
    },
  });

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["crm-global-tags"] }),
    qc.invalidateQueries({ queryKey: ["crm_tags"] }),
    qc.invalidateQueries({ queryKey: ["leads-meta"] }),
  ]);

  const save = useMutation({
    mutationFn: async () => {
      const result = editing
        ? await db.rpc("crm_global_tag_update", { p_id: editing.id, p_nome: form.nome.trim(), p_cor: form.cor })
        : await db.rpc("crm_global_tag_create", { p_nome: form.nome.trim(), p_cor: form.cor });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      toast.success(editing ? "Tag atualizada em todas as empresas" : "Tag criada em todas as empresas");
      setOpen(false);
      setEditing(null);
      setForm({ nome: "", cor: "#C14F21" });
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await db.rpc("crm_global_tag_delete", { p_id: id });
      if (error) throw error;
    },
    onSuccess: async () => { toast.success("Tag removida de todas as empresas"); await refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-medium">Tags globais</h2>
        <Button onClick={() => { setEditing(null); setForm({ nome: "", cor: "#C14F21" }); setOpen(true); }}><Plus className="mr-2 h-4 w-4" />Nova tag</Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">As tags são iguais para todas as empresas e serão incluídas automaticamente em novas empresas.</p>
      {isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <div key={tag.id} className="flex items-center gap-2 rounded-lg border bg-card p-2">
              <Badge style={{ backgroundColor: tag.cor, color: "#fff" }} className="border-0">{tag.nome}</Badge>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(tag); setForm({ nome: tag.nome, cor: tag.cor }); setOpen(true); }}><Pencil className="h-3 w-3" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { if (confirm(`Remover a tag "${tag.nome}" de todas as empresas?`)) remove.mutate(tag.id); }}><Trash2 className="h-3 w-3" /></Button>
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar tag global" : "Nova tag global"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Nome</Label><Input value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} /></div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="flex items-center gap-2"><input type="color" value={form.cor} onChange={(event) => setForm({ ...form, cor: event.target.value })} className="h-9 w-12 rounded border bg-background" /><Input value={form.cor} onChange={(event) => setForm({ ...form, cor: event.target.value })} className="font-mono" /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => save.mutate()} disabled={!form.nome.trim() || save.isPending}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
