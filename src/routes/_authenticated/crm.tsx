import { loadFunnels, moveLead, attendanceStage, readPages } from "@/hml/unified-stages";
import { useCompanyModules } from "@/hml/modules";
import { AttendanceColumn } from "@/components/attendance-column";
import { OpportunityDetail } from "@/components/opportunity-detail";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Plus, UserRound, GripVertical } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { useCrmUser } from "@/hooks/use-crm-user";

import {
  db,
  one,
  Notice,
  inputClass,
  actionClass,
  secondaryClass,
  type Funnel,
  type Stage,
  type Opportunity,
  type Contact,
  type Member,
} from "@/hml/modules";

export const Route = createFileRoute("/_authenticated/crm")({
  validateSearch: (search: Record<string, unknown>): { oportunidade?: string } =>
    typeof search.oportunidade === "string" ? { oportunidade: search.oportunidade } : {},
  component: CommercialPage,
});
function CommercialPage() {
  const { activeEmpresaId } = useActiveEmpresa();
  const { oportunidade } = Route.useSearch();
  if (activeEmpresaId && oportunidade)
    return (
      <OpportunityDetail
        key={activeEmpresaId + ":" + oportunidade}
        companyId={activeEmpresaId}
        id={oportunidade}
      />
    );
  return activeEmpresaId ? (
    <CommercialWorkspace key={activeEmpresaId} companyId={activeEmpresaId} />
  ) : null;
}
function CommercialWorkspace({ companyId }: { companyId: number }) {
  const { data: me } = useCrmUser();
  const qc = useQueryClient();
  const [funnelId, setFunnelId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const modules = useCompanyModules(companyId);
  const unified = !!(modules.data?.crm && modules.data.atendimento_ia);
  const [view, setView] = useState("Todos");
  const canCreate = me?.role === "manager" || me?.role === "super_admin";
  const query = useQuery({
    queryKey: ["commercial-workspace", companyId, me?.id, unified],
    enabled: !!modules.data && !!me,
    queryFn: async () => {
      const [catalog, allOps, allContacts, users] = await Promise.all([
        loadFunnels(companyId, unified),
        readPages<Opportunity>((a, b) =>
          db
            .from("crm_opportunities")
            .select("*")
            .eq("id_empresa", companyId)
            .order("created_at", { ascending: false })
            .order("id")
            .range(a, b),
        ),
        readPages<Contact>((a, b) =>
          db
            .from("crm_leads")
            .select("id,nome,telefone,email,crm_stage_id,crm_assigned_to")
            .eq("id_empresa", companyId)
            .order("nome")
            .order("id")
            .range(a, b),
        ),
        db
          .from("crm_users")
          .select("id,nome,role,active")
          .eq("id_empresa", companyId)
          .in("role", ["manager", "agent"])
          .order("nome"),
      ]);
      if (users.error) throw users.error;
      return {
        ...catalog,
        opportunities: allOps,
        contacts: allContacts,
        members: users.data as Member[],
      };
    },
  });
  const funnels = query.data?.funnels.filter((f) => f.module === "crm") ?? [];
  const activeFunnel =
    funnels.find((f) => f.id === funnelId) ?? funnels.find((f) => f.is_default) ?? funnels[0];
  const iaFunnels = query.data?.funnels.filter((f) => f.module === "ia") ?? [];
  const linked = new Set(query.data?.opportunities.map((o) => o.lead_id));
  const attendance =
    query.data?.contacts.filter(
      (c) => !linked.has(c.id) && (me?.role !== "agent" || c.crm_assigned_to === me.id),
    ) ?? [];
  const iaStages =
    query.data?.stages.filter((s) => iaFunnels.some((f) => f.id === s.id_funnel)) ?? [];
  const leadTargets =
    query.data?.stages.filter(
      (s) =>
        (me?.role === "super_admin" && iaStages.some((a) => a.id === s.id)) ||
        (canCreate && s.id_funnel === activeFunnel?.id),
    ) ?? [];
  const contactsByStage = new Map<number | undefined, Contact[]>();
  for (const contact of unified ? attendance : []) {
    const id = attendanceStage(contact.crm_stage_id, iaFunnels, iaStages)?.id;
    const group = contactsByStage.get(id);
    if (group) group.push(contact);
    else contactsByStage.set(id, [contact]);
  }
  const attendanceColumns: { stage?: Stage; funnelName?: string; contacts: Contact[] }[] =
    iaFunnels.flatMap((f) =>
      iaStages
        .filter((s) => s.id_funnel === f.id)
        .map((stage) => ({
          stage,
          funnelName: f.nome,
          contacts: contactsByStage.get(stage.id) ?? [],
        })),
    );
  if (contactsByStage.has(undefined))
    attendanceColumns.push({ contacts: contactsByStage.get(undefined)! });
  const promote = useMutation({
    mutationFn: async ({ contact, stage }: { contact: Contact; stage: Stage }) => {
      const funnel = query.data?.funnels.find((f) => f.id === stage.id_funnel);
      if (!me || !funnel || !canCreate || (funnel.module === "ia" && me.role !== "super_admin"))
        throw new Error("Movimentação indisponível para seu perfil.");
      await moveLead(
        companyId,
        contact,
        stage,
        funnel,
        me.id,
        attendanceStage(contact.crm_stage_id, query.data!.funnels, query.data!.stages)?.nome,
      );
    },
    onSuccess: () => toast.success("Etapa atualizada"),
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => qc.invalidateQueries(),
  });
  const stages = query.data?.stages.filter((s) => s.id_funnel === activeFunnel?.id) ?? [];
  const opportunities =
    query.data?.opportunities.filter((o) => o.funnel_id === activeFunnel?.id) ?? [];
  const move = useMutation({
    mutationFn: async ({ op, stageId }: { op: Opportunity; stageId: number }) => {
      const { data, error } = await db.rpc("hub_move_opportunity", {
        p_id: op.id,
        p_stage_id: stageId,
        p_expected_version: op.version,
      });
      if (error) throw error;
      return one<Opportunity>(data);
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast.success("Etapa comercial atualizada");
    },
    onError: async (e: Error) => {
      toast.error(e.message);
      await qc.invalidateQueries();
    },
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }));
  const onDragEnd = (event: DragEndEvent) => {
    if (!event.over || move.isPending || promote.isPending) return;
    const contact = attendance.find((c) => "lead-" + c.id === event.active.id);
    if (unified && contact) {
      const stage = query.data?.stages.find((s) => s.id === Number(event.over?.id));
      if (stage && stage.id !== contact.crm_stage_id) promote.mutate({ contact, stage });
      return;
    }
    const op = opportunities.find((o) => o.id === event.active.id);
    const stageId = Number(event.over.id);
    if (op && stageId !== op.stage_id && stages.some((s) => s.id === stageId))
      move.mutate({ op, stageId });
  };
  if (query.isPending) return <p className="p-6">Carregando CRM comercial…</p>;
  if (query.isError)
    return (
      <Notice title="Não foi possível carregar o CRM">
        <p>{query.error.message}</p>
        <button className={secondaryClass} onClick={() => query.refetch()}>
          Tentar novamente
        </button>
      </Notice>
    );
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
            Operação comercial
          </div>
          <h1 className="text-2xl font-bold">CRM comercial</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {unified
              ? `${attendance.length} leads em atendimento · ${opportunities.length} oportunidades neste funil`
              : `${opportunities.length} oportunidades`}
          </p>
        </div>
        <div className="flex gap-3">
          <select
            aria-label="Funil comercial"
            className={inputClass}
            value={activeFunnel?.id ?? ""}
            onChange={(e) => setFunnelId(Number(e.target.value))}
          >
            {funnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
          {canCreate && (
            <button
              className={actionClass + " shrink-0 flex items-center gap-2"}
              disabled={!activeFunnel}
              onClick={() => setCreating(true)}
            >
              <Plus size={16} />
              Nova oportunidade
            </button>
          )}
        </div>
      </header>
      {unified && (
        <div className="flex gap-2" aria-label="Filtrar quadro">
          {["Todos", "Atendimento", "Vendas"].map((v) => (
            <button
              key={v}
              aria-pressed={view === v}
              className={view === v ? actionClass : secondaryClass}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
          {view === "Atendimento" && (
            <Link className={secondaryClass} to="/kanban">
              Detalhes do atendimento
            </Link>
          )}
        </div>
      )}
      {!activeFunnel && !unified ? (
        <Notice title="Nenhum funil comercial disponível">
          Solicite a configuração do módulo ao administrador.
        </Notice>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-5">
            {unified &&
              view !== "Vendas" &&
              attendanceColumns.map(({ stage, funnelName, contacts }) => (
                <AttendanceColumn
                  key={stage?.id ?? "unassigned"}
                  stage={stage}
                  funnelName={funnelName}
                  contacts={contacts}
                  draggable={canCreate && !promote.isPending}
                  targets={leadTargets}
                  funnels={query.data.funnels}
                  onMove={(contact, stage) => promote.mutate({ contact, stage })}
                />
              ))}
            {(!unified || view !== "Atendimento") &&
              stages.map((stage) => (
                <Column
                  key={stage.id}
                  group={unified ? "Vendas" : undefined}
                  stage={stage}
                  opportunities={opportunities.filter((o) => o.stage_id === stage.id)}
                  contacts={query.data.contacts}
                  members={query.data.members}
                  disabled={move.isPending}
                />
              ))}
          </div>
        </DndContext>
      )}
      {canCreate && activeFunnel && (
        <NewOpportunity
          key={creating ? "open" : "closed"}
          open={creating}
          onClose={() => setCreating(false)}
          companyId={companyId}
          funnel={activeFunnel}
          contacts={query.data.contacts.filter(
            (c) => !opportunities.some((o) => o.lead_id === c.id),
          )}
          members={query.data.members}
          defaultAssignee={me?.id_empresa === companyId ? me.id : ""}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Nesta etapa, cada lead tem uma oportunidade por funil. Oportunidades sem responsável podem
        ser distribuídas pelo menu Filas de distribuição.
      </p>
    </div>
  );
}
function Column({
  stage,
  group,
  opportunities,
  contacts,
  members,
  disabled,
}: {
  stage: Stage;
  group?: string;
  opportunities: Opportunity[];
  contacts: Contact[];
  members: Member[];
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section
      ref={setNodeRef}
      aria-label={stage.nome}
      className={`w-64 shrink-0 rounded-xl border bg-muted ${isOver ? "ring-2 ring-orange-300" : ""}`}
    >
      {group && <p className="px-4 pt-3 text-xs text-muted-foreground">{group}</p>}
      <header className="flex items-center justify-between border-b p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="h-2 w-2 rounded-full" style={{ background: stage.cor }} />
          {stage.nome}
        </h2>
        <span className="rounded-full bg-white px-2 text-xs">{opportunities.length}</span>
      </header>
      <div className="min-h-52 space-y-3 p-3">
        {opportunities.map((op) => (
          <OpportunityCard
            key={op.id}
            op={op}
            contact={contacts.find((c) => c.id === op.lead_id)}
            member={members.find((m) => m.id === op.assigned_to)}
            disabled={disabled}
          />
        ))}
        {!opportunities.length && (
          <p className="py-8 text-center text-xs text-slate-400">Sem oportunidades nesta etapa</p>
        )}
      </div>
    </section>
  );
}
function OpportunityCard({
  op,
  contact,
  member,
  disabled,
}: {
  op: Opportunity;
  contact?: Contact;
  member?: Member;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: op.id, disabled });
  return (
    <article
      ref={setNodeRef}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px,${transform.y}px,0)`,
              zIndex: 10,
              position: "relative",
            }
          : undefined
      }
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start gap-2">
        <button
          aria-label={`Mover oportunidade de ${contact?.nome ?? op.title}`}
          className="touch-none text-slate-400"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </button>
        <Link
          to="/crm"
          search={{ oportunidade: op.id }}
          className="text-left text-sm font-semibold hover:text-primary"
        >
          {contact?.nome ?? op.title}
        </Link>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{op.title}</p>
      <div className="mt-4 flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
        <UserRound size={13} />
        {member?.nome ?? "Sem responsável"}
      </div>
      <Link
        className="mt-3 inline-block text-xs font-medium text-primary"
        to="/crm"
        search={{ oportunidade: op.id }}
      >
        Abrir oportunidade →
      </Link>
    </article>
  );
}
export function NewOpportunity({
  open,
  onClose,
  companyId,
  funnel,
  contacts,
  members,
  defaultAssignee,
  existingOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  companyId: number;
  funnel: Funnel;
  contacts: Contact[];
  members: Member[];
  defaultAssignee: string;
  existingOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"existing" | "new">(contacts.length ? "existing" : "new");
  const [requestId] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({
    leadId: contacts[0]?.id ? String(contacts[0].id) : "",
    name: "",
    phone: "",
    email: "",
    title: "",
    assigned: defaultAssignee,
  });
  const create = useMutation({
    mutationFn: async () => {
      const params = {
        p_company_id: companyId,
        p_funnel_id: funnel.id,
        p_assigned_to: form.assigned || null,
        p_request_id: requestId,
      };
      const result =
        mode === "existing"
          ? await db.rpc("hub_create_opportunity", {
              ...params,
              p_lead_id: Number(form.leadId),
              p_title:
                form.title.trim() || contacts.find((c) => c.id === Number(form.leadId))?.nome,
            })
          : await db.rpc("hub_create_contact_opportunity", {
              ...params,
              p_name: form.name.trim(),
              p_phone: form.phone.replace(/\D/g, ""),
              p_email: form.email.trim() || null,
            });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast.success("Oportunidade criada");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const field = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !create.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {existingOnly ? "Encaminhar ao CRM interno" : "Nova oportunidade"}
          </DialogTitle>
          <DialogDescription>
            {existingOnly
              ? `Crie uma oportunidade no funil ${funnel.nome}. Depois, você pode distribuí-la aos corretores pela área Filas.`
              : `Funil ${funnel.nome}. Nenhum atendimento IA ou envio externo será iniciado.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <fieldset disabled={create.isPending} className="space-y-4">
            {!existingOnly && (
              <div className="flex gap-4 text-sm">
                <label>
                  <input
                    type="radio"
                    name="contact-mode"
                    checked={mode === "existing"}
                    onChange={() => setMode("existing")}
                  />{" "}
                  Lead existente
                </label>
                <label>
                  <input
                    type="radio"
                    name="contact-mode"
                    checked={mode === "new"}
                    onChange={() => setMode("new")}
                  />{" "}
                  Novo lead
                </label>
              </div>
            )}
            {mode === "existing" ? (
              <>
                <label className="block text-sm">
                  Lead
                  <select
                    aria-label="Lead"
                    required
                    className={inputClass + " mt-1"}
                    value={form.leadId}
                    onChange={(e) => field("leadId", e.target.value)}
                  >
                    <option value="">Selecionar lead</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Título da oportunidade
                  <input
                    aria-label="Título da oportunidade"
                    className={inputClass + " mt-1"}
                    maxLength={200}
                    placeholder="Opcional: usa o nome do lead"
                    value={form.title}
                    onChange={(e) => field("title", e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="block text-sm">
                  Nome
                  <input
                    aria-label="Nome do lead"
                    required
                    minLength={2}
                    maxLength={150}
                    className={inputClass + " mt-1"}
                    value={form.name}
                    onChange={(e) => field("name", e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  Telefone com DDI
                  <input
                    aria-label="Telefone com DDI"
                    required
                    className={inputClass + " mt-1"}
                    value={form.phone}
                    onChange={(e) => field("phone", e.target.value)}
                    placeholder="Use um número fictício no teste"
                  />
                </label>
                <label className="block text-sm">
                  Email
                  <input
                    aria-label="Email do lead"
                    type="email"
                    className={inputClass + " mt-1"}
                    value={form.email}
                    onChange={(e) => field("email", e.target.value)}
                  />
                </label>
              </>
            )}
            <label className="block text-sm">
              Responsável comercial
              <select
                aria-label="Responsável comercial"
                className={inputClass + " mt-1"}
                value={form.assigned}
                onChange={(e) => field("assigned", e.target.value)}
              >
                <option value="">Sem responsável</option>
                {members
                  .filter((m) => m.active !== false)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryClass} onClick={onClose}>
                Cancelar
              </button>
              <button
                className={actionClass}
                type="submit"
                disabled={mode === "existing" && !form.leadId}
              >
                {create.isPending ? "Salvando…" : "Criar oportunidade"}
              </button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
