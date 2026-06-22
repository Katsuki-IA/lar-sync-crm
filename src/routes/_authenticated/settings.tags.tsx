import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/settings/tags")({
  component: TagsPage,
});

type Tag = { id: number; nome: string; cor: string };

function TagsPage() {
  const qc = useQueryClient();
  const { data: tags = [], isLoading } = useQuery({
    queryKey: ["crm_tags"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_tags")
        .select("id,nome,cor")
        .order("nome", { ascending: true });
      if (error) throw error;
      return data as Tag[];
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [form, setForm] = useState({ nome: "", cor: "#C14F21" });

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        const { error } = await supabase
          .from("crm_tags")
          .update({ nome: form.nome, cor: form.cor })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { data: u } = await supabase.auth.getUser();
        const { data: me } = await supabase
          .from("crm_users")
          .select("id_empresa")
          .eq("auth_user_id", u.user!.id)
          .maybeSingle();
        if (!me?.id_empresa) throw new Error("Empresa não encontrada");
        const { error } = await supabase.from("crm_tags").insert({
          nome: form.nome,
          cor: form.cor,
          id_empresa: me.id_empresa,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Tag atualizada" : "Tag criada");
      qc.invalidateQueries({ queryKey: ["crm_tags"] });
      setOpen(false);
      setEditing(null);
      setForm({ nome: "", cor: "#C14F21" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("crm_tags").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tag removida");
      qc.invalidateQueries({ queryKey: ["crm_tags"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium">Tags</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditing(null); setForm({ nome: "", cor: "#C14F21" }); }}>
              <Plus className="h-4 w-4 mr-2" />Nova tag
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Editar tag" : "Nova tag"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
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
      ) : tags.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhuma tag cadastrada.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card">
              <Badge style={{ background: t.cor, color: "#fff" }} className="border-0">{t.nome}</Badge>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(t); setForm({ nome: t.nome, cor: t.cor ?? "#C14F21" }); setOpen(true); }}>
                <Pencil className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { if (confirm(`Remover tag "${t.nome}"?`)) del.mutate(t.id); }}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}