import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckSquare2, Plus, Pencil, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { db, Notice, inputClass, useCompanyModules } from "./modules";
import { adminRpc, useAdminMutation } from "./administration";

type Task = {
  id: string;
  id_empresa: number;
  lead_id: number;
  opportunity_id: string | null;
  titulo: string;
  descricao: string | null;
  prioridade: string;
  status: string;
  prazo: string;
  assigned_to: string;
  created_by: string;
  revision: number;
  completed_at: string | null;
};
type TaskMember = { id: string; nome: string; role: string; active: boolean };
type TaskContact = { id: number; nome: string; crm_assigned_to: string | null };
type TaskOpportunity = { id: string; lead_id: number; title: string; assigned_to: string | null };
type Context = { members: TaskMember[]; contacts: TaskContact[]; opportunities: TaskOpportunity[] };
const statuses: Record<string, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  cancelada: "Cancelada",
  vencida: "Vencida",
};
const priorities: Record<string, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta" };
const activeStatuses = ["pendente", "em_andamento", "vencida"];
const dateLabel = (value: string) =>
  new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
function localDate(value: string) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
const taskFields =
  "id,id_empresa,lead_id,opportunity_id,titulo,descricao,prioridade,status,prazo,assigned_to,created_by,revision,completed_at";

export function ContactTasks({ leadId }: { leadId: number }) {
  const { activeEmpresaId } = useActiveEmpresa();
  const { data: modules } = useCompanyModules();
  return modules?.crm && activeEmpresaId ? (
    <TaskWorkspace companyId={activeEmpresaId} leadId={leadId} compact />
  ) : null;
}
export function TaskWorkspace({
  companyId,
  leadId,
  opportunityId,
  compact = false,
}: {
  companyId: number;
  leadId?: number;
  opportunityId?: string;
  compact?: boolean;
}) {
  const { data: me } = useCrmUser();
  const [filter, setFilter] = useState("open");
  const [owner, setOwner] = useState("all");
  const [priority, setPriority] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [editing, setEditing] = useState<Task | null | undefined>(undefined);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const context = useQuery({
    queryKey: ["task-context", companyId, me?.id, me?.role],
    queryFn: async () => {
      const results = await Promise.all([
        db
          .from("crm_users")
          .select("id,nome,role,active")
          .eq("id_empresa", companyId)
          .in("role", ["manager", "agent"])
          .order("nome"),
        db
          .from("crm_leads")
          .select("id,nome,crm_assigned_to")
          .eq("id_empresa", companyId)
          .order("nome"),
        db
          .from("crm_opportunities")
          .select("id,lead_id,title,assigned_to")
          .eq("id_empresa", companyId),
      ]);
      for (const r of results) if (r.error) throw r.error;
      return {
        members: results[0].data,
        contacts: results[1].data,
        opportunities: results[2].data,
      } as Context;
    },
  });
  const query = useQuery({
    queryKey: [
      "commercial-tasks",
      companyId,
      leadId,
      opportunityId,
      filter,
      owner,
      priority,
      search,
      page,
      Math.floor(clock / 60000),
      me?.id,
      me?.role,
    ],
    enabled: !!me?.active,
    queryFn: async () => {
      let q = db
        .from("crm_lead_tasks")
        .select(taskFields, { count: "exact" })
        .eq("id_empresa", companyId);
      if (leadId) q = q.eq("lead_id", leadId);
      if (opportunityId) q = q.eq("opportunity_id", opportunityId);
      if (filter === "open" || filter === "overdue" || filter === "today")
        q = q.in("status", activeStatuses);
      else if (filter !== "all") q = q.eq("status", filter);
      if (filter === "overdue") q = q.lt("prazo", new Date(clock).toISOString());
      if (filter === "today") {
        const start = new Date(clock);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        q = q.gte("prazo", start.toISOString()).lt("prazo", end.toISOString());
      }
      if (owner !== "all") q = q.eq("assigned_to", owner === "me" ? me!.id : owner);
      if (priority !== "all") q = q.eq("prioridade", priority);
      if (search.trim())
        q = q.ilike("titulo", "%" + search.trim().replace(/[\\%_]/g, "\\$&") + "%");
      const { data, error, count } = await q
        .order("prazo")
        .order("id")
        .range(page * 10, page * 10 + 9);
      if (error) throw error;
      return { tasks: data as unknown as Task[], count: count ?? 0 };
    },
  });
  const change = (setter: (v: string) => void, value: string) => {
    setter(value);
    setPage(0);
  };
  return (
    <section
      className={
        compact ? "space-y-4 rounded-xl border bg-white p-4" : "mx-auto max-w-6xl space-y-6"
      }
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {compact ? (
            <h2 className="flex items-center gap-2 font-semibold">
              <CheckSquare2 size={18} />
              Tarefas {opportunityId ? "da oportunidade" : "do lead"}
            </h2>
          ) : (
            <h1 className="text-2xl font-bold">Tarefas</h1>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {compact
              ? "Prazos e próximos passos comerciais."
              : "Organize os próximos passos de cada lead e oportunidade."}
          </p>
        </div>
        <Button disabled={!context.data} onClick={() => setEditing(null)}>
          <Plus />
          Nova tarefa
        </Button>
      </header>
      <div className="flex flex-wrap gap-2">
        <Input
          className="w-full bg-white sm:w-52"
          aria-label="Buscar tarefas"
          placeholder="Buscar por título"
          value={search}
          onChange={(e) => change(setSearch, e.target.value)}
        />
        <select
          className={inputClass.replace("w-full", "w-full sm:w-auto")}
          aria-label="Filtrar situação das tarefas"
          value={filter}
          onChange={(e) => change(setFilter, e.target.value)}
        >
          <option value="open">Em aberto</option>
          <option value="overdue">Vencidas</option>
          <option value="today">Para hoje</option>
          <option value="concluida">Concluídas</option>
          <option value="cancelada">Canceladas</option>
          <option value="all">Todas as situações</option>
        </select>
        <select
          className={inputClass.replace("w-full", "w-full sm:w-auto") + " max-w-full"}
          aria-label="Filtrar responsável das tarefas"
          value={owner}
          onChange={(e) => change(setOwner, e.target.value)}
        >
          <option value="all">
            {me?.role === "agent" ? "Minhas tarefas" : "Todos os responsáveis"}
          </option>
          {me?.role !== "agent" && (
            <>
              <option value="me">Minhas tarefas</option>
              {context.data?.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                  {!m.active ? " · Suspenso" : ""}
                </option>
              ))}
            </>
          )}
        </select>
        {!compact && (
          <select
            className={inputClass.replace("w-full", "w-full sm:w-auto")}
            aria-label="Filtrar prioridade"
            value={priority}
            onChange={(e) => change(setPriority, e.target.value)}
          >
            <option value="all">Todas as prioridades</option>
            {Object.entries(priorities).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        )}
      </div>
      {context.isError && (
        <Notice title="Não foi possível carregar leads e equipe">
          <Button variant="outline" onClick={() => context.refetch()}>
            Tentar novamente
          </Button>
        </Notice>
      )}
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando tarefas…</p>
      ) : query.isError ? (
        <Notice title="Não foi possível carregar as tarefas">
          <Button variant="outline" onClick={() => query.refetch()}>
            Tentar novamente
          </Button>
        </Notice>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {query.data.count}{" "}
            {query.data.count === 1 ? "tarefa encontrada" : "tarefas encontradas"} · Horários em{" "}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
          <div className="space-y-3">
            {query.data.tasks.map((task) => {
              const overdue =
                activeStatuses.includes(task.status) && new Date(task.prazo).getTime() < clock;
              const member = context.data?.members.find((m) => m.id === task.assigned_to);
              return (
                <article key={task.id} className="rounded-xl border bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold">{task.titulo}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {context.data?.contacts.find((c) => c.id === task.lead_id)?.nome ??
                          "Lead"}
                        {task.opportunity_id
                          ? " · " +
                            (context.data?.opportunities.find((o) => o.id === task.opportunity_id)
                              ?.title ?? "Oportunidade")
                          : ""}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!context.data}
                      onClick={() => setEditing(task)}
                      aria-label={`Editar tarefa ${task.titulo}`}
                    >
                      <Pencil />
                      Editar
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded-full px-2 py-1 ${overdue ? "bg-accent text-accent-foreground" : "bg-muted"}`}
                    >
                      {overdue ? "Vencida" : statuses[task.status]}
                    </span>
                    <span className="rounded-full border px-2 py-1">
                      Prioridade {priorities[task.prioridade]?.toLowerCase()}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock3 size={13} />
                      {dateLabel(task.prazo)}
                    </span>
                  </div>
                  {task.descricao && (
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {task.descricao}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {member?.nome ?? "Responsável"}
                      {member?.active === false ? " · Suspenso" : ""}
                    </span>
                    <Link
                      className="text-primary underline"
                      to="/leads/$id"
                      params={{ id: String(task.lead_id) }}
                    >
                      Abrir lead
                    </Link>
                  </div>
                  <TaskHistory taskId={task.id} members={context.data?.members ?? []} />
                </article>
              );
            })}
          </div>
          {!query.data.count && (
            <Notice title="Nenhuma tarefa neste filtro">
              Crie uma tarefa ou escolha outra situação para consultar o histórico.
            </Notice>
          )}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!page}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground">Página {page + 1}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * 10 >= query.data.count}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </>
      )}
      {editing !== undefined && context.data && (
        <TaskEditor
          companyId={companyId}
          leadId={leadId}
          opportunityId={opportunityId}
          task={editing}
          context={context.data}
          onClose={() => setEditing(undefined)}
        />
      )}
    </section>
  );
}
function TaskEditor({
  companyId,
  leadId,
  opportunityId,
  task,
  context,
  onClose,
}: {
  companyId: number;
  leadId?: number;
  opportunityId?: string;
  task: Task | null;
  context: Context;
  onClose: () => void;
}) {
  const { data: me } = useCrmUser();
  const [requestId] = useState(() => crypto.randomUUID());
  const [contact, setContact] = useState(String(task?.lead_id ?? leadId ?? ""));
  const [op, setOp] = useState(task?.opportunity_id ?? opportunityId ?? "");
  const [title, setTitle] = useState(task?.titulo ?? "");
  const [description, setDescription] = useState(task?.descricao ?? "");
  const [priority, setPriority] = useState(task?.prioridade ?? "normal");
  const [status, setStatus] = useState(
    task?.status === "vencida" ? "pendente" : (task?.status ?? "pendente"),
  );
  const [due, setDue] = useState(
    localDate(task?.prazo ?? new Date(Date.now() + 86400000).toISOString()),
  );
  const [assignee, setAssignee] = useState(
    task?.assigned_to ?? (me?.id_empresa === companyId ? me.id : ""),
  );
  const eligible = context.members.filter(
    (m) =>
      m.active &&
      (me?.role !== "agent" || m.id === me.id) &&
      (m.role === "manager" ||
        (op
          ? context.opportunities.some((o) => o.id === op && o.assigned_to === m.id)
          : context.contacts.some((c) => c.id === Number(contact) && c.crm_assigned_to === m.id) ||
            context.opportunities.some(
              (o) => o.lead_id === Number(contact) && o.assigned_to === m.id,
            ))),
  );
  const save = useAdminMutation<void>(
    () =>
      adminRpc("hub_save_task", {
        p_company_id: companyId,
        p_task_id: task?.id ?? null,
        p_lead_id: Number(contact),
        p_opportunity_id: op || null,
        p_title: title,
        p_description: description || null,
        p_priority: priority,
        p_due_at: task && due === localDate(task.prazo) ? task.prazo : new Date(due).toISOString(),
        p_assigned_to: assignee,
        p_status: status,
        p_expected_revision: task?.revision ?? null,
        p_request_id: task ? null : requestId,
      }),
    task ? "Tarefa atualizada" : "Tarefa criada",
    onClose,
  );
  const dirty =
    !task ||
    title !== task.titulo ||
    description !== (task.descricao ?? "") ||
    priority !== task.prioridade ||
    due !== localDate(task.prazo) ||
    assignee !== task.assigned_to ||
    status !== (task.status === "vencida" ? "pendente" : task.status);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{task ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
          <DialogDescription>
            Defina o próximo passo. Prazos no fuso{" "}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}. Nenhuma mensagem será enviada.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <fieldset disabled={save.isPending} className="space-y-4">
            <label className="block text-sm">
              Lead
              <select
                className={inputClass + " mt-1"}
                aria-label="Lead da tarefa"
                required
                disabled={!!task || !!leadId}
                value={contact}
                onChange={(e) => {
                  setContact(e.target.value);
                  setOp("");
                  setAssignee(me?.role === "agent" ? me.id : "");
                }}
              >
                <option value="">Selecione o lead</option>
                {context.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Oportunidade
              <select
                className={inputClass + " mt-1"}
                aria-label="Oportunidade da tarefa"
                disabled={!!task || !!opportunityId || !contact}
                value={op}
                onChange={(e) => {
                  setOp(e.target.value);
                  setAssignee(me?.role === "agent" ? me.id : "");
                }}
              >
                <option value="">Tarefa geral do lead</option>
                {context.opportunities
                  .filter((o) => o.lead_id === Number(contact))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-sm">
              Título
              <Input
                className="mt-1"
                aria-label="Título da tarefa"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                minLength={2}
                maxLength={200}
                required
                placeholder="Ex.: confirmar interesse após a visita"
              />
            </label>
            <label className="block text-sm">
              Descrição
              <Textarea
                className="mt-1"
                aria-label="Descrição da tarefa"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={4000}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                Prazo
                <Input
                  className="mt-1"
                  aria-label="Prazo da tarefa"
                  type="datetime-local"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  required
                />
              </label>
              <label className="block text-sm">
                Prioridade
                <select
                  className={inputClass + " mt-1"}
                  aria-label="Prioridade da tarefa"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {Object.entries(priorities).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              Responsável
              <select
                className={inputClass + " mt-1"}
                aria-label="Responsável da tarefa"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                required
                disabled={me?.role === "agent"}
              >
                <option value="">Selecione um responsável</option>
                {eligible.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
                {task && !eligible.some((m) => m.id === task.assigned_to) && (
                  <option value={task.assigned_to}>
                    {context.members.find((m) => m.id === task.assigned_to)?.nome ??
                      "Responsável atual"}{" "}
                    · indisponível para novas atribuições
                  </option>
                )}
              </select>
              <span className="mt-1 block text-xs text-muted-foreground">
                Novas atribuições exigem acesso ao lead e à oportunidade.
              </span>
            </label>
            {task && (
              <label className="block text-sm">
                Situação
                <select
                  className={inputClass + " mt-1"}
                  aria-label="Situação da tarefa"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {Object.entries(statuses)
                    .filter(([v]) => v !== "vencida")
                    .map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Cancelar
            </Button>
            <Button disabled={save.isPending || !dirty || !contact || !assignee}>
              {save.isPending ? "Salvando…" : task ? "Salvar tarefa" : "Criar tarefa"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function TaskHistory({ taskId, members }: { taskId: string; members: TaskMember[] }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["task-history", taskId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await db
        .from("hub_task_events")
        .select("id,actor_name,kind,before_data,after_data,created_at")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false })
        .order("id")
        .limit(20);
      if (error) throw error;
      return data;
    },
  });
  const labels: Record<string, string> = {
    titulo: "Título",
    descricao: "Descrição",
    prioridade: "Prioridade",
    status: "Situação",
    prazo: "Prazo",
    assigned_to: "Responsável",
  };
  const display = (key: string, v: unknown) =>
    v == null
      ? "Não informado"
      : key === "prazo"
        ? dateLabel(String(v))
        : key === "assigned_to"
          ? (members.find((m) => m.id === v)?.nome ?? "Membro indisponível")
          : key === "status"
            ? statuses[String(v)]
            : key === "prioridade"
              ? priorities[String(v)]
              : String(v);
  return (
    <details className="mt-3 border-t pt-3 text-xs" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="text-primary">Histórico da tarefa</summary>
      {open &&
        (query.isPending ? (
          <p className="mt-2">Carregando…</p>
        ) : query.isError ? (
          <Button variant="link" onClick={() => query.refetch()}>
            Tentar novamente
          </Button>
        ) : (
          <div className="mt-3 space-y-3">
            {query.data?.map((e) => (
              <div key={e.id} className="rounded-lg bg-muted p-3">
                <p className="font-medium">
                  {e.kind === "created" ? "Tarefa criada" : "Tarefa atualizada"} · {e.actor_name}
                </p>
                <p className="text-muted-foreground">{dateLabel(e.created_at)}</p>
                {Object.keys(labels)
                  .filter(
                    (k) => JSON.stringify(e.before_data?.[k]) !== JSON.stringify(e.after_data[k]),
                  )
                  .map((k) => (
                    <p className="mt-1 break-words" key={k}>
                      {labels[k]}: {e.before_data ? display(k, e.before_data[k]) + " → " : ""}
                      {display(k, e.after_data[k])}
                    </p>
                  ))}
              </div>
            ))}
            {!query.data?.length && (
              <p>
                Sem eventos registrados. Tarefas anteriores a esta etapa não têm histórico
                retroativo.
              </p>
            )}
            {query.data?.length === 20 && <p>Exibindo as 20 alterações mais recentes.</p>}
          </div>
        ))}
    </details>
  );
}

