import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import {
  parseCustomFieldOptions,
  type LeadCustomField,
  type LeadCustomFieldType,
} from "@/lib/lead-custom-fields";

export const Route = createFileRoute("/_authenticated/settings/custom-fields")({
  beforeLoad: () => { throw redirect({ to: "/settings/users" }); },
});

type FieldForm = {
  nome: string;
  tipo: LeadCustomFieldType;
  obrigatorio: boolean;
  opcoes: string[];
};

const EMPTY_FORM: FieldForm = {
  nome: "",
  tipo: "text",
  obrigatorio: false,
  opcoes: [],
};

const TYPE_LABELS: Record<LeadCustomFieldType, string> = {
  text: "Texto",
  select: "Seleção única",
  checkbox: "Múltipla escolha",
};

const db = supabase as any;

export function GlobalCustomFieldsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LeadCustomField | null>(null);
  const [deleting, setDeleting] = useState<LeadCustomField | null>(null);
  const [form, setForm] = useState<FieldForm>(EMPTY_FORM);

  const { data: fields = [], isLoading } = useQuery({
    queryKey: ["global-lead-custom-fields-settings"],
    queryFn: async () => {
      const { data, error } = await db
        .from("crm_global_custom_fields")
        .select("id,nome,tipo,obrigatorio,opcoes,ordem,ativo")
        .eq("ativo", true)
        .order("ordem", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((field) => ({
        ...field,
        id_empresa: 0,
        tipo: field.tipo as LeadCustomFieldType,
        opcoes: parseCustomFieldOptions(field.opcoes),
      })) as LeadCustomField[];
    },
  });

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(field: LeadCustomField) {
    setEditing(field);
    setForm({
      nome: field.nome,
      tipo: field.tipo,
      obrigatorio: field.obrigatorio,
      opcoes: [...field.opcoes],
    });
    setOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const nome = form.nome.trim();
      if (!nome) throw new Error("Informe o nome do campo");

      const options =
        form.tipo === "text"
          ? []
          : form.opcoes
              .map((option) => option.trim())
              .filter(
                (option, index, all) =>
                  Boolean(option) &&
                  all.findIndex((item) => item.toLowerCase() === option.toLowerCase()) === index,
              );
      if (form.tipo !== "text" && options.length === 0) {
        throw new Error("Adicione pelo menos uma opção");
      }

      if (editing) {
        const { error } = await db.rpc("crm_global_custom_field_update", {
          p_id: editing.id, p_nome: nome, p_obrigatorio: form.obrigatorio, p_opcoes: options,
        });
        if (error) throw error;
        return;
      }

      const { error } = await db.rpc("crm_global_custom_field_create", {
        p_nome: nome, p_tipo: form.tipo, p_obrigatorio: form.obrigatorio, p_opcoes: options,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editing ? "Campo atualizado" : "Campo criado");
      qc.invalidateQueries({ queryKey: ["global-lead-custom-fields-settings"] });
      qc.invalidateQueries({ queryKey: ["lead-custom-fields"] });
      setOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const archive = useMutation({
    mutationFn: async (field: LeadCustomField) => {
      const { error } = await db.rpc("crm_global_custom_field_archive", { p_id: field.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Campo removido do cadastro");
      qc.invalidateQueries({ queryKey: ["global-lead-custom-fields-settings"] });
      qc.invalidateQueries({ queryKey: ["lead-custom-fields"] });
      setDeleting(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const move = useMutation({
    mutationFn: async ({ index, direction }: { index: number; direction: -1 | 1 }) => {
      const current = fields[index];
      const neighbor = fields[index + direction];
      if (!current || !neighbor) return;
      const next = [...fields];
      [next[index], next[index + direction]] = [neighbor, current];
      const { error } = await db.rpc("crm_global_custom_fields_reorder", {
        p_ids: next.map((field) => field.id),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["global-lead-custom-fields-settings"] });
      qc.invalidateQueries({ queryKey: ["lead-custom-fields"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function setType(tipo: LeadCustomFieldType) {
    setForm((current) => ({
      ...current,
      tipo,
      opcoes: tipo === "text" ? [] : current.opcoes.length > 0 ? current.opcoes : [""],
    }));
  }

  return (
    <>
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div><h2 className="text-lg font-medium">Campos globais do lead</h2><p className="text-sm text-muted-foreground">Aplicados a todas as empresas e ao cadastro de novas empresas.</p></div>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" />
            Novo campo
          </Button>
        </div>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
        ) : fields.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum campo personalizado.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <div className="grid min-w-[680px] grid-cols-[minmax(0,1fr)_150px_100px_116px] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-xs uppercase text-muted-foreground">
              <span>Campo</span>
              <span>Tipo</span>
              <span>Obrigatório</span>
              <span className="text-right">Ações</span>
            </div>
            {fields.map((field, index) => (
              <div
                key={field.id}
                className="grid min-w-[680px] grid-cols-[minmax(0,1fr)_150px_100px_116px] items-center gap-3 border-b border-border px-4 py-3 last:border-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{field.nome}</p>
                  {field.opcoes.length > 0 && (
                    <p className="truncate text-xs text-muted-foreground">
                      {field.opcoes.join(", ")}
                    </p>
                  )}
                </div>
                <Badge variant="secondary" className="w-fit">
                  {TYPE_LABELS[field.tipo]}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {field.obrigatorio ? "Sim" : "Não"}
                </span>
                <div className="flex justify-end gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Mover para cima"
                    disabled={index === 0 || move.isPending}
                    onClick={() => move.mutate({ index, direction: -1 })}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Mover para baixo"
                    disabled={index === fields.length - 1 || move.isPending}
                    onClick={() => move.mutate({ index, direction: 1 })}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Editar campo"
                    onClick={() => openEdit(field)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Remover campo"
                    onClick={() => setDeleting(field)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar campo" : "Novo campo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="custom-field-name">Nome</Label>
              <Input
                id="custom-field-name"
                value={form.nome}
                maxLength={120}
                onChange={(event) =>
                  setForm((current) => ({ ...current, nome: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={form.tipo}
                onValueChange={(value) => setType(value as LeadCustomFieldType)}
                disabled={Boolean(editing)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Texto</SelectItem>
                  <SelectItem value="select">Seleção única</SelectItem>
                  <SelectItem value="checkbox">Múltipla escolha</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5">
              <Label htmlFor="custom-field-required">Obrigatório no cadastro</Label>
              <Switch
                id="custom-field-required"
                checked={form.obrigatorio}
                onCheckedChange={(checked) =>
                  setForm((current) => ({ ...current, obrigatorio: checked }))
                }
              />
            </div>

            {form.tipo !== "text" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Opções</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setForm((current) => ({ ...current, opcoes: [...current.opcoes, ""] }))
                    }
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Adicionar
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.opcoes.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={option}
                        placeholder={`Opção ${index + 1}`}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            opcoes: current.opcoes.map((item, itemIndex) =>
                              itemIndex === index ? event.target.value : item,
                            ),
                          }))
                        }
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        title="Remover opção"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            opcoes: current.opcoes.filter((_, itemIndex) => itemIndex !== index),
                          }))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => save.mutate()} disabled={!form.nome.trim() || save.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(nextOpen) => !nextOpen && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover campo do cadastro?</AlertDialogTitle>
            <AlertDialogDescription>
              O campo deixará de aparecer em novos cadastros. Os valores já registrados serão
              preservados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && archive.mutate(deleting)}
              disabled={archive.isPending}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
