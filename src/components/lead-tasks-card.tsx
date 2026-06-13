import { useState } from "react";
import { CheckCircle2, Clock, Plus, Trash2, AlertCircle, Play, X as XIcon, CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useCrmUser } from "@/hooks/use-crm-user";
import {
  useLeadTasks,
  useCreateLeadTask,
  useUpdateLeadTask,
  useDeleteLeadTask,
  effectiveStatus,
  type TaskPriority,
  type TaskStatus,
  type LeadTask,
} from "@/hooks/use-lead-tasks";
import { cn } from "@/lib/utils";

const PRIORITY_LABEL: Record<TaskPriority, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta" };
const STATUS_LABEL: Record<TaskStatus, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  vencida: "Vencida",
  cancelada: "Cancelada",
};

function priorityClass(p: TaskPriority) {
  if (p === "alta") return "bg-destructive/15 text-destructive border-0";
  if (p === "baixa") return "bg-muted text-muted-foreground border-0";
  return "bg-primary/10 text-primary border-0";
}

function statusClass(s: TaskStatus) {
  switch (s) {
    case "concluida": return "bg-emerald-500/15 text-emerald-600 border-0";
    case "vencida": return "bg-destructive/15 text-destructive border-0";
    case "em_andamento": return "bg-amber-500/15 text-amber-600 border-0";
    case "cancelada": return "bg-muted text-muted-foreground border-0";
    default: return "bg-secondary text-secondary-foreground border-0";
  }
}

function defaultDateString() {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toEndOfDay(isoDate: string) {
  return new Date(`${isoDate}T23:59:59`).toISOString();
}

export function LeadTasksCard({
  leadId,
  users,
}: {
  leadId: number;
  users: { id: string; nome: string }[];
}) {
  const { data: me } = useCrmUser();
  const { data: tasks = [] } = useLeadTasks(leadId);
  const createMut = useCreateLeadTask(leadId);
  const updateMut = useUpdateLeadTask(leadId);
  const deleteMut = useDeleteLeadTask(leadId);
  const [open, setOpen] = useState(false);

  const isManager = me?.role === "super_admin" || me?.role === "manager";

  const [form, setForm] = useState({
    titulo: "",
    descricao: "",
    prioridade: "normal" as TaskPriority,
    prazo: defaultDateString(),
    assigned_to: me?.id ?? "",
  });

  function resetForm() {
    setForm({
      titulo: "",
      descricao: "",
      prioridade: "normal",
      prazo: defaultDateString(),
      assigned_to: me?.id ?? "",
    });
  }

  async function handleCreate() {
    if (!form.titulo.trim()) {
      toast.error("Informe um título");
      return;
    }
    if (!form.assigned_to) {
      toast.error("Selecione um responsável");
      return;
    }
    try {
      await createMut.mutateAsync({
        titulo: form.titulo.trim(),
        descricao: form.descricao.trim() || undefined,
        prioridade: form.prioridade,
        prazo: new Date(form.prazo).toISOString(),
        assigned_to: form.assigned_to,
      });
      toast.success("Tarefa criada");
      setOpen(false);
      resetForm();
    } catch (e: any) {
      toast.error("Erro ao criar tarefa", { description: e.message });
    }
  }

  const userMap = new Map(users.map((u) => [u.id, u.nome]));

  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Tarefas</CardTitle>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-xl"><Plus className="h-4 w-4 mr-1" /> Nova</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Nova tarefa</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Título *</Label>
                <Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex: Ligar para o lead" />
              </div>
              <div>
                <Label>Descrição</Label>
                <Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} className="min-h-20" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Prioridade</Label>
                  <Select value={form.prioridade} onValueChange={(v) => setForm({ ...form, prioridade: v as TaskPriority })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="baixa">Baixa</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="alta">Alta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Prazo *</Label>
                  <Input type="datetime-local" value={form.prazo} onChange={(e) => setForm({ ...form, prazo: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Responsável</Label>
                {isManager ? (
                  <Select value={form.assigned_to} onValueChange={(v) => setForm({ ...form, assigned_to: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={me?.nome ?? ""} disabled />
                )}
                {!isManager && (
                  <p className="text-xs text-muted-foreground mt-1">Você só pode criar tarefas para si mesmo.</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={createMut.isPending}>
                {createMut.isPending ? "Salvando…" : "Criar tarefa"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-2">
        {tasks.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma tarefa para este lead.</p>
        )}
        {tasks.map((t) => {
          const status = effectiveStatus(t);
          const due = new Date(t.prazo);
          return (
            <div key={t.id} className={cn("p-3 rounded-xl border border-border flex gap-3", status === "vencida" && "border-destructive/40 bg-destructive/5")}>
              <button
                title="Marcar concluída"
                onClick={() => updateMut.mutate({ id: t.id, status: status === "concluida" ? "pendente" : "concluida" })}
                className={cn(
                  "h-5 w-5 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center transition-colors",
                  status === "concluida" ? "bg-emerald-500 border-emerald-500 text-white" : "border-muted-foreground/40 hover:border-primary",
                )}
              >
                {status === "concluida" && <CheckCircle2 className="h-3.5 w-3.5" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={cn("text-sm font-medium", status === "concluida" && "line-through text-muted-foreground")}>{t.titulo}</p>
                    {t.descricao && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{t.descricao}</p>}
                  </div>
                  <TaskMenu task={t} effective={status} onChange={(s) => updateMut.mutate({ id: t.id, status: s })} onDelete={() => { if (confirm("Excluir tarefa?")) deleteMut.mutate(t.id); }} />
                </div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <Badge className={statusClass(status)}>{STATUS_LABEL[status]}</Badge>
                  <Badge className={priorityClass(t.prioridade)}>{PRIORITY_LABEL[t.prioridade]}</Badge>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" /> {due.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                  <span className="text-xs text-muted-foreground">· {userMap.get(t.assigned_to) ?? "—"}</span>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function TaskMenu({
  task,
  effective,
  onChange,
  onDelete,
}: {
  task: LeadTask;
  effective: TaskStatus;
  onChange: (s: TaskStatus) => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">Ações</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {effective !== "em_andamento" && (
          <DropdownMenuItem onClick={() => onChange("em_andamento")}>
            <Play className="h-3.5 w-3.5 mr-2" /> Em andamento
          </DropdownMenuItem>
        )}
        {effective !== "concluida" && (
          <DropdownMenuItem onClick={() => onChange("concluida")}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Concluir
          </DropdownMenuItem>
        )}
        {effective !== "pendente" && (
          <DropdownMenuItem onClick={() => onChange("pendente")}>
            <AlertCircle className="h-3.5 w-3.5 mr-2" /> Reabrir (pendente)
          </DropdownMenuItem>
        )}
        {effective !== "cancelada" && (
          <DropdownMenuItem onClick={() => onChange("cancelada")}>
            <XIcon className="h-3.5 w-3.5 mr-2" /> Cancelar
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onDelete} className="text-destructive">
          <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}