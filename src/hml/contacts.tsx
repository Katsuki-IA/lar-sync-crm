import { CustomLeadFields } from "@/hml/custom-lead-fields";
import {PermanentHistoryLink} from './permanent-history-link';
import {useIntegrations,crmNames} from './integrations';
import {CvSendDialog} from './cv-delivery';
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Columns3,
  List,
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  ExternalLink,
  MessagesSquare,
  Link2,
  Send,
  X,
  Upload,
  PauseCircle,
  Bot,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { useCrmUser } from "@/hooks/use-crm-user";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { NewOpportunity } from "@/routes/_authenticated/crm";
import {
  db,
  useCompanyModules,
  Notice,
  inputClass,
  type Contact,
  type Funnel,
  type Member,
} from "@/hml/modules";

import { LeadOperations } from "@/hml/lead-operations";
import {
  rowPermissions,
  fetchCrmSentIds,
  pauseAiAttendance,
  startAiAttendance,
  deleteLead,
  type Role,
  type CrmSentState,
} from "@/hml/lead-row-actions";

type DirectoryContact = Contact & {
  id_empreendimento: number | null;
  created_at: string | null;
  updated_at: string | null;
  development_name: string | null;
  stage_name: string | null;
  stage_color: string | null;
  owner_name: string | null;
  status: string | null;
  ai_status: "active" | "paused" | "none";
  tags: { id: number; nome: string; cor: string | null }[];
  opportunities: { id: string; title: string; stage_id: number; stage_name: string | null }[];
};
type Directory = { rows: DirectoryContact[]; total: number; today: number; filtered: number };
type DirectoryStage = {
  id: number;
  nome: string;
  cor: string | null;
  module: string;
  id_funnel: number;
  ativo: boolean;
};
type Metadata = {
  stages: DirectoryStage[];
  funnels: Funnel[];
  members: Member[];
  developments: { id: number; nome: string }[];
  tags: { id: number; nome: string }[];
};
const emptyFilters = {
  search: "",
  funnel: "",
  stage: "",
  owner: "",
  development: "",
  tag: "",
  status: "",
  from: "",
  to: "",
};
const statusLabels = {
  active: "Em atendimento",
  paused: "Atendimento pausado",
  none: "Sem atendimento",
};
const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});
const dateLabel = (value: string | null) => (value ? dateFormat.format(new Date(value)) : "—");

export function ContactsPage() {
  const { activeEmpresaId } = useActiveEmpresa();
  const { data: modules } = useCompanyModules();
  const { data: me } = useCrmUser();
  return activeEmpresaId && modules && me ? (
    <ContactDirectory
      key={`${activeEmpresaId}:${modules.revision}:${me.id}`}
      companyId={activeEmpresaId}
      ia={modules.atendimento_ia}
      crm={modules.crm}
      canEdit={me.role === "manager" || me.role === "super_admin"}
      actorId={me.id}
      canDelete={me.role === "super_admin"}
      role={me.role}
    />
  ) : (
    <p>Carregando leads…</p>
  );
}

function ContactDirectory({
  companyId,
  ia,
  crm,
  canEdit,
  actorId,
  canDelete,
  role,
}: {
  companyId: number;
  ia: boolean;
  crm: boolean;
  canEdit: boolean;
  actorId: string;
  canDelete: boolean;
  role: Role;
}) {
  const qc = useQueryClient();
  const integration = useIntegrations(companyId);

  const [cvSending,setCvSending]=useState<DirectoryContact|null>(null);

  const [selected, setSelected] = useState<DirectoryContact[]>([]);
  const [historyLead,setHistoryLead]=useState<number|null>(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [view, setView] = useState<"list" | "kanban">("list");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [customLead, setCustomLead] = useState<number | null>(null);
  const [editing, setEditing] = useState<DirectoryContact | null>(null);
  const [sending, setSending] = useState<DirectoryContact | null>(null);
  const [sendFunnelId, setSendFunnelId] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [rowPause, setRowPause] = useState<DirectoryContact | null>(null);
  const [rowStart, setRowStart] = useState<DirectoryContact | null>(null);
  const [rowDelete, setRowDelete] = useState<DirectoryContact | null>(null);
  const [rowDeleteText, setRowDeleteText] = useState("");
  const isSuperAdmin = role === "super_admin";
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), 250);
    return () => clearTimeout(timer);
  }, [filters.search]);
  const change = (key: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value, ...(key === "funnel" ? { stage: "" } : {}) }));
    setPage(0);
  };
  const reset = () => {
    setFilters(emptyFilters);
    setDebouncedSearch("");
    setPage(0);
  };
  const invalidDates = !!filters.from && !!filters.to && filters.from > filters.to;
  const meta = useQuery({
    queryKey: ["contact-directory-meta", companyId, actorId],
    queryFn: async (): Promise<Metadata> => {
      const { data, error } = await db.rpc("hub_lead_directory_metadata", {
        p_company_id: companyId,
      });
      if (error) throw error;
      return data as Metadata;
    },
  });
  const query = useQuery({
    queryKey: [
      "leads",
      "directory",
      companyId,
      actorId,
      { ...filters, search: debouncedSearch },
      page,
      size,
      view,
    ],
    enabled: !invalidDates,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Directory> => {
      if (view === "kanban") {
        const {data,error} = await db.rpc("hub_export_leads", {p_company_id: companyId,p_filters:Object.fromEntries(Object.entries({...filters,search:debouncedSearch}).map(([k,v])=>[k,v||null]))});
        if(error) throw error;
        const rows = data as DirectoryContact[];
        return {rows,filtered:rows.length,total:lastSummary?.total??rows.length,today:lastSummary?.today??0};
      }
      const { data, error } = await db.rpc("hub_list_contacts", {
        p_company_id: companyId,
        p_search: debouncedSearch,
        p_funnel_id: Number(filters.funnel) || null,
        p_stage_id: Number(filters.stage) || null,
        p_owner_id: filters.owner || null,
        p_development_id: Number(filters.development) || null,
        p_tag_id: Number(filters.tag) || null,
        p_status: filters.status,
        p_from: filters.from || null,
        p_to: filters.to || null,
        p_page: page,
        p_size: size,
      });
      if (error) throw error;
      return data as Directory;
    },
  });
  useEffect(() => setSelected([]), [filters, page, size, view]);
  const pages = Math.max(1, Math.ceil((query.data?.filtered ?? 0) / size));
  const [lastSummary, setLastSummary] = useState<{ total: number; today: number } | null>(null);
  useEffect(() => {
    if (query.data && view === "list") setLastSummary({ total: query.data.total, today: query.data.today });
  }, [query.data]);
  const summary = view === "kanban" ? lastSummary ?? query.data : query.data ?? lastSummary;
  useEffect(() => {
    if (view === "list" && query.data && page >= pages) setPage(pages - 1);
  }, [query.data, page, pages]);
  const stages =
    meta.data?.stages.filter(
      (s) =>
        s.module === (ia ? "ia" : "crm") &&
        (!filters.funnel || s.id_funnel === Number(filters.funnel)),
    ) ?? [];
  const iaFunnels = meta.data?.funnels.filter((f) => f.module === "ia") ?? [];
  const salesFunnels = meta.data?.funnels.filter((f) => f.module === "crm") ?? [];
  const sendFunnel =
    salesFunnels.find((f) => f.id === Number(sendFunnelId)) ??
    salesFunnels.find((f) => f.is_default) ??
    salesFunnels[0];
  const rows = query.data?.rows ?? [];
  const shownIds = rows.map((r) => r.id);
  const crmSentQuery = useQuery({
    queryKey: ["contact-crm-sent", companyId, actorId, shownIds.join(",")],
    enabled: shownIds.length > 0,
    queryFn: () => fetchCrmSentIds(db, shownIds),
  });
  const crmSentState = (id: number): CrmSentState =>
    crmSentQuery.isSuccess ? (crmSentQuery.data.includes(id) ? "sent" : "not_sent") : "unknown";
  const refreshLeads = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["leads"] }),
      qc.invalidateQueries({ queryKey: ["contact-crm-sent"] }),
      qc.invalidateQueries({ queryKey: ["lead-ai-status"] }),
      qc.invalidateQueries({ queryKey: ["lead-activities"] }),
      qc.invalidateQueries({ queryKey: ["lead"] }),
    ]);
  };
  const pauseMut = useMutation({
    mutationFn: (contact: DirectoryContact) => pauseAiAttendance(db, contact.id),
    onSuccess: async () => { toast.success("Atendimento da IA pausado"); setRowPause(null); await refreshLeads(); },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });
  const startMut = useMutation({
    mutationFn: (contact: DirectoryContact) => startAiAttendance(db, { leadId: contact.id, companyId, actorId }),
    onSuccess: async () => { toast.success("Lead enviado para Atendimento IA"); setRowStart(null); await refreshLeads(); },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });
  const deleteMut = useMutation({
    mutationFn: (contact: DirectoryContact) => deleteLead(db, companyId, contact.id),
    onSuccess: async () => { toast.success("Lead excluído"); setRowDelete(null); setRowDeleteText(""); setSelected([]); await refreshLeads(); },
    onError: (e: Error) => toast.error("Erro ao excluir lead", { description: e.message }),
  });
  const clearable = Object.values(filters).some(Boolean);
  const selectedLabels: Partial<Record<keyof typeof filters, string>> = {
    search: `Busca: ${filters.search}`,
    funnel: `Funil: ${iaFunnels.find((f) => String(f.id) === filters.funnel)?.nome ?? ""}`,
    stage: `Estágio: ${meta.data?.stages.find((s) => String(s.id) === filters.stage)?.nome ?? ""}`,
    owner: `Responsável: ${meta.data?.members.find((m) => m.id === filters.owner)?.nome ?? ""}`,
    development: `Empreendimento: ${meta.data?.developments.find((e) => String(e.id) === filters.development)?.nome ?? ""}`,
    tag: `Tag: ${meta.data?.tags.find((t) => String(t.id) === filters.tag)?.nome ?? ""}`,
    status: `Status: ${statusLabels[filters.status as keyof typeof statusLabels] ?? filters.status}`,
    from: `De: ${filters.from.split("-").reverse().join("/")}`,
    to: `Até: ${filters.to.split("-").reverse().join("/")}`,
  };
  const [dragged, setDragged] = useState<number | null>(null);
  const move = useMutation({
    mutationFn: async ({contact,stageId}:{contact:DirectoryContact;stageId:number}) => {
      if(!isSuperAdmin || !ia) throw new Error("Sem permissão para mover este lead.");
      const {error}=await db.rpc("hub_bulk_leads", {p_company_id:companyId,p_rows:[{id:contact.id,updated_at:contact.updated_at}],p_action:"stage",p_value:String(stageId)});
      if(error) throw error;
    },
    onSuccess: async () => { toast.success("Estágio atualizado"); setSelected([]); await qc.invalidateQueries(); },
    onError: async (error:Error) => { toast.error(error.message); await qc.invalidateQueries(); },
  });
  const actions = (contact: DirectoryContact) => {
    const perm = rowPermissions(role, contact.ai_status, crmSentState(contact.id));
    const sentState = crmSentState(contact.id);
    return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Ações de ${contact.nome}`}>
          <MoreHorizontal size={18} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onSelect={() => setCustomLead(contact.id)}>Campos personalizados</DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/leads/$id" params={{ id: String(contact.id) }}>
            <ExternalLink size={15} /> Abrir lead e atividades
          </Link>
        </DropdownMenuItem>
        {canEdit && (
          <DropdownMenuItem onSelect={() => setEditing(contact)}>
            <Pencil size={15} /> Editar lead{ia && isSuperAdmin ? " / estágio" : ""}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {ia && (
          <>
            <DropdownMenuItem asChild>
              <Link to="/conversas" search={{ lead: String(contact.id) }}>
                <MessagesSquare size={15} /> Visualizar conversa
              </Link>
            </DropdownMenuItem>
            {canEdit && (
              <DropdownMenuItem onSelect={()=>setHistoryLead(contact.id)}>
                  <Link2 size={15} /> Copiar link do histórico
              </DropdownMenuItem>
            )}
            {canEdit && (perm.showPausedBadge ? (
              <DropdownMenuItem disabled>
                <PauseCircle size={15} /> Atendimento da IA pausado
              </DropdownMenuItem>
            ) : perm.canPauseAi ? (
              <DropdownMenuItem onSelect={() => setRowPause(contact)}>
                <PauseCircle size={15} /> Pausar Atendimento da IA
              </DropdownMenuItem>
            ) : perm.canStartAi ? (
              <DropdownMenuItem onSelect={() => setRowStart(contact)}>
                <Bot size={15} /> Enviar para Atendimento IA
              </DropdownMenuItem>
            ) : null)}
            <DropdownMenuSeparator />
          </>
        )}
        {canEdit && sentState === "unknown" && (
          <DropdownMenuItem disabled>
            <Send size={15} /> {crmSentQuery.isError ? "Status de envio ao CRM indisponível" : "Verificando envio ao CRM…"}
          </DropdownMenuItem>
        )}
        {perm.canSendCrm &&
          (integration.data?.provider==='katsuki' && crm ? (
            <DropdownMenuItem
              disabled={!salesFunnels.length}
              onSelect={() => {
                setSending(contact);
                setConfirmSend(salesFunnels.length === 1);
              }}
            >
              <Send size={15} /> Encaminhar ao CRM interno
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem disabled={!integration.data?.provider} onSelect={()=>setCvSending(contact)}>
                <Send size={15} /> Enviar ao CRM externo
              </DropdownMenuItem>
            </>
          ))}
        {perm.canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { setRowDeleteText(""); setRowDelete(contact); }}>
              <Trash2 size={15} /> Excluir lead
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    );
  };
  const identity = (contact: DirectoryContact) => (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/leads/$id"
          params={{ id: String(contact.id) }}
          className="font-semibold text-foreground hover:text-primary hover:underline"
        >
          {contact.nome}
        </Link>
        {ia && contact.ai_status === "paused" && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
            Pausado
          </span>
        )}
        {crmSentState(contact.id) === "sent" && (
          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
            Enviado CRM
          </span>
        )}
      </div>
      <p className="mt-0.5 break-all text-xs text-muted-foreground">
        {contact.email || "Sem email"}
      </p>
      {!!contact.tags.length && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {contact.tags.map((tag) => (
            <span
              key={tag.id}
              className="rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {tag.nome}
            </span>
          ))}
        </div>
      )}
    </div>
  );
  return (
    <div className="min-w-0 space-y-5">
      {historyLead !== null && <PermanentHistoryLink companyId={companyId} leadId={historyLead} onClose={()=>setHistoryLead(null)} />}
      {customLead !== null && <CustomLeadFields companyId={companyId} leadId={customLead} onClose={() => setCustomLead(null)} />}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {summary ? (
              <>
                <span className="font-medium text-foreground">{summary.total}</span> leads no
                total · <span className="font-medium text-primary">{summary.today}</span> novos hoje
              </>
            ) : (
              "Carregando leads da empresa…"
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {ia && isSuperAdmin && (
          <Button asChild variant="outline">
            <Link to="/leads/importar">
              <Upload size={16} /> Importar leads
            </Link>
          </Button>
        )}
        {canEdit && (
          <Button asChild>
            <Link to={ia ? "/leads/new" : "/crm"}>
              <Plus size={16} />
              {ia ? "Novo lead" : "Novo lead pelo CRM"}
            </Link>
          </Button>
        )}
        </div>
      </header>
      <LeadOperations companyId={companyId} ia={ia} canEdit={canEdit} canDelete={canDelete} canAssign={isSuperAdmin} showImport={!ia} filters={filters} selected={selected} meta={meta.data} onDone={() => { setSelected([]); void qc.invalidateQueries(); }} />
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 text-muted-foreground" size={17} />
          <input
            className={inputClass + " h-11 pl-10 pr-10"}
            aria-label="Buscar leads"
            placeholder="Buscar por nome, telefone, email ou ID…"
            value={filters.search}
            onChange={(e) => change("search", e.target.value)}
          />
          {filters.search && (
            <button
              aria-label="Limpar busca"
              onClick={() => change("search", "")}
              className="absolute right-3 top-3 text-muted-foreground"
            >
              <X size={16} />
            </button>
          )}
        </div>
        {ia ? (
          <div
            role="group"
            aria-label="Visualização dos leads"
            className="flex shrink-0 gap-1 rounded-lg border bg-background p-1"
          >
            <Button
              size="icon"
              variant={view === "list" ? "secondary" : "ghost"}
              aria-label="Visualizar em lista"
              aria-pressed={view === "list"}
              title="Lista"
              onClick={() => setView("list")}
            >
              <List size={18} />
            </Button>
            <Button
              size="icon"
              variant={view === "kanban" ? "secondary" : "ghost"}
              aria-label="Visualizar em Kanban"
              aria-pressed={view === "kanban"}
              title="Kanban de atendimento IA"
              onClick={() => { setPage(0); setView("kanban"); }}
            >
              <Columns3 size={18} />
            </Button>
          </div>
        ) : (
          <Button asChild variant="outline">
            <Link to="/crm">
              <Columns3 size={16} />
              Kanban comercial
            </Link>
          </Button>
        )}
      </div>
      {meta.isError ? (
        <Notice title="Não foi possível carregar os filtros">
          <Button variant="outline" onClick={() => meta.refetch()}>
            Tentar novamente
          </Button>
        </Notice>
      ) : (
        <section aria-label="Filtros de leads" className="rounded-xl border bg-background p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
            {iaFunnels.length > 1 && (
              <Filter
                label="Funil IA"
                value={filters.funnel}
                onChange={(v) => change("funnel", v)}
                options={iaFunnels}
                all="Todos os funis"
              />
            )}
            <Filter
              label={ia && crm ? "Estágio IA" : "Estágio"}
              value={filters.stage}
              onChange={(v) => change("stage", v)}
              options={stages}
              all="Todos os estágios"
            />
            <Filter
              label={ia && crm ? "Responsável IA" : "Responsável"}
              value={filters.owner}
              onChange={(v) => change("owner", v)}
              options={meta.data?.members ?? []}
            />
            <Filter
              label="Empreendimento"
              value={filters.development}
              onChange={(v) => change("development", v)}
              options={meta.data?.developments ?? []}
            />
            <Filter
              label="Tag"
              value={filters.tag}
              onChange={(v) => change("tag", v)}
              options={meta.data?.tags ?? []}
              all="Todas"
            />
            <Filter
              label={ia ? "Status IA" : "Status"}
              value={filters.status}
              onChange={(v) => change("status", v)}
              options={
                ia
                  ? Object.entries(statusLabels).map(([id, nome]) => ({ id, nome }))
                  : [
                      { id: "ativo", nome: "Ativo" },
                      { id: "inativo", nome: "Inativo" },
                    ]
              }
            />
            <Field label="Criado de">
              <input
                aria-label="Criado de"
                type="date"
                className={inputClass}
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) => change("from", e.target.value)}
              />
            </Field>
            <Field label="Criado até">
              <input
                aria-label="Criado até"
                type="date"
                className={inputClass}
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => change("to", e.target.value)}
              />
            </Field>
          </div>
          {invalidDates && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              A data inicial deve ser anterior ou igual à final.
            </p>
          )}
          {clearable && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
              {Object.entries(filters)
                .filter(([, value]) => value)
                .map(([key]) => (
                  <button
                    key={key}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-muted/30 px-2.5 py-1 text-xs hover:bg-muted"
                    onClick={() => change(key as keyof typeof filters, "")}
                    aria-label={`Remover ${selectedLabels[key as keyof typeof filters]}`}
                  >
                    {selectedLabels[key as keyof typeof filters]}
                    <X size={12} />
                  </button>
                ))}
              <Button size="sm" variant="ghost" onClick={reset}>
                Limpar filtros
              </Button>
            </div>
          )}
        </section>
      )}
      {ia && crm && (
        <p className="text-xs text-muted-foreground">
          Os filtros de estágio, responsável e status se referem ao atendimento IA. As oportunidades
          comerciais aparecem separadamente.
        </p>
      )}
      {invalidDates ? null : query.isError ? (
        <Notice title="Não foi possível carregar os leads">
          <p className="mb-3">{query.error.message}</p>
          <Button variant="outline" onClick={() => query.refetch()}>
            Tentar novamente
          </Button>
        </Notice>
      ) : query.isPending ? (
        <p role="status" className="rounded-xl border p-8 text-sm text-muted-foreground">
          Carregando leads…
        </p>
      ) : (
        <>
          <div
            className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <span>
              {query.data.filtered}{" "}
              {query.data.filtered === 1 ? "lead encontrado" : "leads encontrados"}
              {query.isFetching ? " · Atualizando…" : ""}
            </span>
            {view === "kanban" && (
              <span>
                Kanban de atendimento IA · Todos os resultados filtrados · {isSuperAdmin ? "Arraste ou use Mover para alterar o estágio" : "Estágio alterado somente por superadministradores"}
              </span>
            )}
          </div>
          {!rows.length ? (
            <div className="rounded-xl border bg-background p-12 text-center">
              <Search size={24} className="mx-auto mb-3 text-muted-foreground" />
              <h2 className="font-semibold">Nenhum lead encontrado</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {clearable
                  ? "Ajuste os filtros para ampliar a busca."
                  : "Os leads cadastrados nesta empresa aparecerão aqui."}
              </p>
              {clearable && (
                <Button variant="outline" className="mt-4" onClick={reset}>
                  Limpar filtros
                </Button>
              )}
            </div>
          ) : view === "list" ? (
            <div className="overflow-x-auto rounded-xl border bg-background">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  Leads da empresa, ordenados pelos mais recentes
                </caption>
                <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {<th className="px-3"><input type="checkbox" aria-label="Selecionar página" checked={rows.length > 0 && rows.every(r => selected.some(s => s.id === r.id))} onChange={e => setSelected(e.target.checked ? rows : [])} /></th>}
                    {[
                      "ID",
                      "Nome",
                      "Telefone",
                      "Empreendimento",
                      ...(ia ? [crm ? "Estágio IA" : "Estágio"] : []),
                      ...(crm ? ["Oportunidades"] : []),
                      "Criado",
                      "Ações",
                    ].map((label) => (
                      <th
                        key={label}
                        scope="col"
                        className="whitespace-nowrap px-4 py-3 font-medium"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((contact) => (
                    <tr
                      key={contact.id}
                      className={`border-b last:border-0 hover:bg-muted/30 ${ia && contact.ai_status === "paused" ? "bg-amber-50/40" : ""}`}
                    >
                      {<td className="px-3"><input type="checkbox" aria-label={`Selecionar ${contact.nome}`} checked={selected.some(s => s.id === contact.id)} onChange={e => setSelected(old => e.target.checked ? [...old, contact] : old.filter(s => s.id !== contact.id))} /></td>}
                      <td className="px-4 py-4 text-xs text-muted-foreground">#{contact.id}</td>
                      <td className="min-w-52 px-4 py-4">{identity(contact)}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-xs text-muted-foreground">
                        {contact.telefone}
                      </td>
                      <td className="min-w-40 px-4 py-4 text-muted-foreground">
                        {contact.development_name ?? (contact.id_empreendimento ? "Empreendimento indisponível neste acesso" : "Sem empreendimento")}
                      </td>
                      {ia && (
                        <td className="min-w-40 px-4 py-4">
                          <StageBadge name={contact.stage_name} color={contact.stage_color} />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {contact.owner_name ?? (contact.crm_assigned_to ? "Responsável indisponível neste acesso" : "Sem responsável")}
                          </p>
                        </td>
                      )}
                      {crm && (
                        <td className="min-w-44 px-4 py-4">
                          {contact.opportunities.length ? (
                            contact.opportunities.map((o) => (
                              <Link
                                key={o.id}
                                to="/crm"
                                className="mb-1 block text-xs text-primary hover:underline"
                              >
                                {o.title} · {o.stage_name ?? "Sem estágio"}
                              </Link>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">Sem oportunidade</span>
                          )}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-4 py-4 text-xs text-muted-foreground">
                        {dateLabel(contact.created_at)}
                      </td>
                      <td className="px-3 py-4">{actions(contact)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              className="flex items-start gap-4 overflow-x-auto pb-3"
              aria-label="Kanban de atendimento IA"
            >
              {[
                ...stages.map((s) => ({ id: s.id as number | null, nome: s.nome, cor: s.cor })),
                ...(rows.some((r) => !stages.some((s) => s.id === r.crm_stage_id))
                  ? [{ id: null, nome: "Sem estágio", cor: null }]
                  : []),
              ]
                .filter((s) => !filters.stage || s.id === Number(filters.stage))
                .map((stage) => {
                  const cards = rows.filter((r) =>
                    stage.id === null
                      ? !stages.some((s) => s.id === r.crm_stage_id)
                      : r.crm_stage_id === stage.id,
                  );
                  return (
                    <section
                      key={stage.id ?? "none"}
                      aria-label={stage.nome}
                      onDragOver={e=>{if(isSuperAdmin && stage.id!==null && !move.isPending)e.preventDefault();}}
                      onDrop={e=>{e.preventDefault();const contact=rows.find(r=>r.id===dragged);setDragged(null);if(contact && isSuperAdmin && stage.id!==null && stage.id!==contact.crm_stage_id && !move.isPending)move.mutate({contact,stageId:stage.id});}}
                      className="w-72 shrink-0 rounded-xl border bg-muted/20 p-3"
                    >
                      <header className="mb-3 flex items-center justify-between gap-2">
                        <StageBadge name={stage.nome} color={stage.cor} />
                        <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
                          {cards.length}
                        </span>
                      </header>
                      <div className="space-y-3">
                        {cards.length ? (
                          cards.map((contact) => (
                            <article
                              key={contact.id}
                              draggable={isSuperAdmin && !move.isPending}
                              onDragStart={e=>{setDragged(contact.id);e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",String(contact.id));}}
                              onDragEnd={()=>setDragged(null)}
                              className="rounded-lg border bg-background p-3 shadow-sm"
                            >
                              <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">#{contact.id}</span>
                                {actions(contact)}
                              </div>
                              {identity(contact)}
                              {isSuperAdmin && <label className="mt-3 block text-xs">Mover para
                                <select className={inputClass} aria-label={`Mover ${contact.nome}`} value={contact.crm_stage_id??""} disabled={move.isPending} onChange={e=>{if(e.target.value)move.mutate({contact,stageId:Number(e.target.value)});}}>
                                  <option value="" disabled>Sem estágio</option>
                                  {stages.filter(s=>s.ativo).map(s=><option key={s.id} value={s.id}>{s.nome}</option>)}
                                </select>
                              </label>}
                              <p className="mt-3 text-xs text-muted-foreground">
                                {contact.telefone}
                              </p>
                              <p className="mt-2 text-sm">
                                {contact.development_name ?? (contact.id_empreendimento ? "Empreendimento indisponível neste acesso" : "Sem empreendimento")}
                              </p>
                              <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
                                <p>{contact.owner_name ?? (contact.crm_assigned_to ? "Responsável indisponível neste acesso" : "Sem responsável")}</p>
                                <p className="mt-1">{dateLabel(contact.created_at)}</p>
                              </div>
                            </article>
                          ))
                        ) : (
                          <p className="py-6 text-center text-xs text-muted-foreground">
                            Nenhum lead neste estágio
                          </p>
                        )}
                      </div>
                    </section>
                  );
                })}
            </div>
          )}
          {view === "list" && <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              {query.data.filtered
                ? `${page * size + 1}–${Math.min((page + 1) * size, query.data.filtered)}`
                : "0"}{" "}
              de {query.data.filtered} · Datas no horário de Brasília
            </span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                Por página
                <select
                  aria-label="Leads por página"
                  className={inputClass.replace("w-full", "w-auto")}
                  value={size}
                  onChange={(e) => {
                    setSize(Number(e.target.value));
                    setPage(0);
                  }}
                >
                  {[25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                size="icon"
                variant="outline"
                aria-label="Página anterior"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={16} />
              </Button>
              <span>
                {page + 1} / {pages}
              </span>
              <Button
                size="icon"
                variant="outline"
                aria-label="Próxima página"
                disabled={page + 1 >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          </footer>}
        </>
      )}
      {editing && meta.data && (
        <EditContact
          key={editing.id}
          contact={editing}
          companyId={companyId}
          ia={ia}
          canChangeStageOrOwner={isSuperAdmin}
          meta={meta.data}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await qc.invalidateQueries();
          }}
        />
      )}
      {rowPause && (
        <Dialog open onOpenChange={(v) => { if (!v && !pauseMut.isPending) setRowPause(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Pausar Atendimento da IA?</DialogTitle>
              <DialogDescription>
                A IA deixará de responder {rowPause.nome}. A conversa continua disponível para atendimento humano.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={pauseMut.isPending} onClick={() => setRowPause(null)}>Cancelar</Button>
              <Button disabled={pauseMut.isPending} onClick={() => pauseMut.mutate(rowPause)}>
                {pauseMut.isPending ? "Pausando…" : "Confirmar pausa"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {rowStart && (
        <Dialog open onOpenChange={(v) => { if (!v && !startMut.isPending) setRowStart(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Enviar para Atendimento IA?</DialogTitle>
              <DialogDescription>
                {rowStart.nome} entrará na fila de atendimento da IA. É necessário ter empreendimento definido.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={startMut.isPending} onClick={() => setRowStart(null)}>Cancelar</Button>
              <Button disabled={startMut.isPending} onClick={() => startMut.mutate(rowStart)}>
                {startMut.isPending ? "Enviando…" : "Confirmar envio"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {rowDelete && (
        <Dialog open onOpenChange={(v) => { if (!v && !deleteMut.isPending) setRowDelete(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Excluir lead #{rowDelete.id}?</DialogTitle>
              <DialogDescription>
                Excluir {rowDelete.nome}? Esta ação não pode ser desfeita. Digite EXCLUIR para confirmar.
              </DialogDescription>
            </DialogHeader>
            <input aria-label="Confirmar exclusão do lead" className={inputClass} value={rowDeleteText} disabled={deleteMut.isPending} onChange={(e) => setRowDeleteText(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={deleteMut.isPending} onClick={() => setRowDelete(null)}>Cancelar</Button>
              <Button variant="destructive" disabled={deleteMut.isPending || rowDeleteText !== "EXCLUIR"} onClick={() => deleteMut.mutate(rowDelete)}>
                {deleteMut.isPending ? "Excluindo…" : "Excluir lead"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {cvSending&&<CvSendDialog company={companyId} lead={cvSending.id} name={cvSending.nome} onClose={()=>setCvSending(null)}/>}
      {sending && !confirmSend && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v) setSending(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Encaminhar ao CRM interno</DialogTitle>
              <DialogDescription>
                Selecione o funil comercial para {sending.nome}.
              </DialogDescription>
            </DialogHeader>
            <Filter
              label="Funil de destino"
              value={String(sendFunnel?.id ?? "")}
              onChange={setSendFunnelId}
              options={salesFunnels}
            />
            <Button disabled={!sendFunnel} onClick={() => setConfirmSend(true)}>
              Continuar
            </Button>
          </DialogContent>
        </Dialog>
      )}
      {sending && confirmSend && sendFunnel && meta.data && (
        <NewOpportunity
          existingOnly
          key={`${sending.id}:${sendFunnel.id}`}
          open
          onClose={() => setSending(null)}
          companyId={companyId}
          funnel={sendFunnel}
          contacts={[sending]}
          members={meta.data.members}
          defaultAssignee=""
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
function Filter({
  label,
  value,
  onChange,
  options,
  all = "Todos",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string | number; nome: string }[];
  all?: string;
}) {
  return (
    <Field label={label}>
      <select
        aria-label={label}
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nome}
          </option>
        ))}
      </select>
    </Field>
  );
}
function StageBadge({ name, color }: { name: string | null; color: string | null }) {
  const safeColor = /^#[0-9a-f]{6}$/i.test(color ?? "") ? color! : "#C14F21";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
      style={{ borderColor: `${safeColor}40`, background: `${safeColor}0c` }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: safeColor }} />
      {name ?? "Sem estágio"}
    </span>
  );
}
function EditContact({
  contact,
  companyId,
  ia,
  canChangeStageOrOwner,
  meta,
  onClose,
  onSaved,
}: {
  contact: DirectoryContact;
  companyId: number;
  ia: boolean;
  canChangeStageOrOwner: boolean;
  meta: Metadata;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: contact.nome ?? "",
    phone: contact.telefone ?? "",
    email: contact.email ?? "",
    development: String(contact.id_empreendimento ?? ""),
    stage: String(contact.crm_stage_id ?? ""),
    owner: contact.crm_assigned_to ?? "",
  });
  const field = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("hub_edit_contact", {
        p_company_id: companyId,
        p_id: contact.id,
        p_expected_updated_at: contact.updated_at,
        p_name: form.name,
        p_phone: form.phone,
        p_email: form.email,
        p_development_id: Number(form.development) || null,
        // Without permission, the current stage/owner are sent unchanged.
        p_stage_id: canChangeStageOrOwner ? Number(form.stage) || null : contact.crm_stage_id ?? null,
        p_owner_id: canChangeStageOrOwner ? form.owner || null : contact.crm_assigned_to ?? null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Lead atualizado");
      await onSaved();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !save.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar lead #{contact.id}</DialogTitle>
          <DialogDescription>
            Atualize o cadastro{ia && canChangeStageOrOwner ? " e o estágio de atendimento IA" : ""}. As oportunidades
            comerciais mantêm seu próprio estágio e responsável.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <fieldset disabled={save.isPending} className="space-y-4">
            <Field label="Nome">
              <input
                aria-label="Nome do lead"
                className={inputClass}
                required
                minLength={2}
                maxLength={150}
                value={form.name}
                onChange={(e) => field("name", e.target.value)}
              />
            </Field>
            <Field label="Telefone com DDI">
              <input
                aria-label="Telefone do lead"
                className={inputClass}
                required
                inputMode="tel"
                value={form.phone}
                onChange={(e) => field("phone", e.target.value)}
              />
            </Field>
            <Field label="Email">
              <input
                aria-label="Email do lead"
                className={inputClass}
                type="email"
                maxLength={254}
                value={form.email}
                onChange={(e) => field("email", e.target.value)}
              />
            </Field>
            <Filter
              label="Empreendimento do lead"
              value={form.development}
              onChange={(v) => field("development", v)}
              options={meta.developments}
              all="Sem empreendimento"
            />
            {ia && canChangeStageOrOwner && (
              <>
                <Filter
                  label="Estágio de atendimento IA"
                  value={form.stage}
                  onChange={(v) => field("stage", v)}
                  options={meta.stages.filter(
                    (s) => s.module === "ia" && (s.ativo || s.id === contact.crm_stage_id),
                  )}
                  all="Sem estágio"
                />
                <Filter
                  label="Responsável pelo atendimento IA"
                  value={form.owner}
                  onChange={(v) => field("owner", v)}
                  options={meta.members.filter((m) => m.active || m.id === contact.crm_assigned_to)}
                  all="Sem responsável"
                />
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit">{save.isPending ? "Salvando…" : "Salvar alterações"}</Button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

