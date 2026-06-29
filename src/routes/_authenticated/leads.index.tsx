import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, Plus, X, Users as UsersIcon, List, LayoutGrid, MoreHorizontal, Pencil, Eye, ArrowRightLeft, UserCog, Trash2, Download, CalendarIcon, Upload, PauseCircle, Bot, MessagesSquare, Link2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { useFunnels } from "@/hooks/use-funnels";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { stageColor } from "@/lib/lead-visuals";
import { KanbanView } from "@/components/kanban-view";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/leads/")({
  component: LeadsList,
});

const PAGE_SIZE = 25;

type LeadListRow = {
  id: number;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  crm_stage_id: number | null;
  crm_assigned_to: string | null;
  id_empreendimento: number | null;
  created_at: string | null;
  historico_token: string | null;
  ai_paused?: boolean;
  ai_active?: boolean;
};

type AiStatusFilter = "all" | "active" | "paused";

function LeadsList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useCrmUser();
  const { data: allowed } = useAllowedEmpresas();
  const [companyId, setCompanyId] = useState<number | null>(null);
  const { data: companies = [] } = useQuery({
    enabled: !!allowed?.length,
    queryKey: ["leads-companies", allowed],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresa_dados")
        .select("id, nome")
        .in("id", allowed ?? [])
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
  useEffect(() => {
    if (!me || !allowed) return;
    const nextCompanyId = me.role === "super_admin"
      ? (companies.find((company) => company.id === companyId)?.id ?? companies[0]?.id ?? null)
      : (me.id_empresa ?? null);
    if (nextCompanyId !== companyId) setCompanyId(nextCompanyId);
  }, [allowed, companies, companyId, me]);

  const { data: funnels = [] } = useFunnels(companyId);
  const [funnelId, setFunnelId] = useState<number | null>(null);
  useEffect(() => {
    if (funnels.length && !funnels.some((funnel) => funnel.id === funnelId)) {
      const def = funnels.find((f) => f.is_default) ?? funnels[0];
      setFunnelId(def.id);
    }
  }, [funnels, funnelId]);
  const currentFunnel = funnels.find((f) => f.id === funnelId) ?? null;
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "kanban">("list");
  const [stage, setStage] = useState<string>("all");
  const [tagId, setTagId] = useState<string>("all");
  const [empId, setEmpId] = useState<string>("all");
  const [userId, setUserId] = useState<string>("all");
  const [aiStatus, setAiStatus] = useState<AiStatusFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    setStage("all");
    setTagId("all");
    setEmpId("all");
    setUserId("all");
    setPage(0);
  }, [companyId]);

  // Bulk selection
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => { setSelected(new Set()); }, [companyId, page, funnelId, stage, tagId, empId, userId, aiStatus, dateFrom, dateTo, search]);

  // Dialogs
  const [bulkStageOpen, setBulkStageOpen] = useState(false);
  const [bulkUserOpen, setBulkUserOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [rowStageLead, setRowStageLead] = useState<number | null>(null);
  const [rowUserLead, setRowUserLead] = useState<number | null>(null);
  const [rowDeleteLead, setRowDeleteLead] = useState<number | null>(null);
  const [rowPauseAiLead, setRowPauseAiLead] = useState<number | null>(null);
  const [rowStartAiLead, setRowStartAiLead] = useState<number | null>(null);
  const [pickStage, setPickStage] = useState<string>("");
  const [pickUser, setPickUser] = useState<string>("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const filters = useMemo(
    () => ({ search, stage, tagId, empId, userId, aiStatus, dateFrom, dateTo, page }),
    [search, stage, tagId, empId, userId, aiStatus, dateFrom, dateTo, page],
  );

  const { data: meta } = useQuery({
    enabled: !!me && companyId != null && funnelId != null,
    queryKey: ["leads-meta", companyId, funnelId],
    queryFn: async () => {
      const [{ data: stages }, { data: tags }, { data: emps }, { data: users }] = await Promise.all([
        supabase.from("crm_stages").select("id, nome, cor").eq("id_empresa", companyId!).eq("ativo", true).eq("id_funnel", funnelId!).order("ordem"),
        supabase.from("crm_tags").select("id, nome, cor").eq("id_empresa", companyId!),
        supabase.from("empreendimento").select("id, nome").eq("id_empresa", companyId!),
        supabase.from("crm_users").select("id, nome").eq("id_empresa", companyId!).eq("active", true),
      ]);
      return { stages: stages ?? [], tags: tags ?? [], emps: emps ?? [], users: users ?? [] };
    },
  });

  const { data, isLoading } = useQuery({
    enabled: !!me && companyId != null && !!meta,
    queryKey: ["leads-list", me?.id, me?.role, filters, companyId, funnelId, (meta?.stages ?? []).map((s) => s.id).join(",")],
    queryFn: async (): Promise<{ rows: LeadListRow[]; count: number }> => {
      let leadIdsByTag: number[] | null = null;
      if (tagId !== "all") {
        const { data: links } = await supabase
          .from("crm_lead_tags")
          .select("lead_id")
          .eq("tag_id", Number(tagId));
        leadIdsByTag = (links ?? []).map((l) => l.lead_id);
        if (!leadIdsByTag.length) return { rows: [], count: 0 };
      }

      let aiLeadIds: number[] | null = null;
      if (aiStatus !== "all") {
        const [{ data: automationRows, error: automationError }, { data: queueRows, error: queueError }] = await Promise.all([
          supabase
            .from("lead")
            .select("id_crm,status,atendimento_humano")
            .eq("id_empresa", companyId!),
          supabase
            .from("fila_leads")
            .select("id_lead")
            .eq("id_empresa", companyId!),
        ]);
        if (automationError) throw automationError;
        if (queueError) throw queueError;

        const activeIds = new Set(
          [
            ...(automationRows ?? []).map((row) => Number(row.id_crm)),
            ...(queueRows ?? []).map((row) => Number(row.id_lead)),
          ].filter(Number.isFinite),
        );
        const pausedIds = new Set(
          (automationRows ?? [])
            .filter((row) => row.atendimento_humano || String(row.status ?? "").trim().toLowerCase() === "atendimento humano")
            .map((row) => Number(row.id_crm))
            .filter(Number.isFinite),
        );

        if (aiStatus === "paused") {
          aiLeadIds = Array.from(pausedIds);
          if (!aiLeadIds.length) return { rows: [], count: 0 };
        } else if (aiStatus === "active") {
          aiLeadIds = Array.from(activeIds).filter((id) => !pausedIds.has(id));
          if (!aiLeadIds.length) return { rows: [], count: 0 };
        }
      }

      let q = supabase
        .from("crm_leads")
        .select("id, nome, telefone, email, crm_stage_id, crm_assigned_to, id_empreendimento, created_at, historico_token", { count: "exact" })
        .eq("id_empresa", companyId!);

      if (me?.role === "agent") q = q.eq("crm_assigned_to", me.id);
      // Restringe ao funil selecionado (estágios desse funil). Funil padrão também inclui leads sem estágio.
      const stageIds = (meta?.stages ?? []).map((s) => s.id);
      if (!stageIds.length && !currentFunnel?.is_default) return { rows: [], count: 0 };
      if (currentFunnel?.is_default) {
        if (stageIds.length) q = q.or(`crm_stage_id.in.(${stageIds.join(",")}),crm_stage_id.is.null`);
      } else {
        q = q.in("crm_stage_id", stageIds);
      }
      if (stage !== "all") q = q.eq("crm_stage_id", Number(stage));
      if (empId !== "all") q = q.eq("id_empreendimento", Number(empId));
      if (userId !== "all") q = q.eq("crm_assigned_to", userId);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo) q = q.lte("created_at", `${dateTo}T23:59:59`);
      if (search) q = q.or(`nome.ilike.%${search}%,telefone.ilike.%${search}%`);
      if (leadIdsByTag) q = q.in("id", leadIdsByTag);
      if (aiLeadIds) {
        q = q.in("id", aiLeadIds);
      }

      q = q.order("created_at", { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data: rows, count, error } = await q;
      if (error) throw error;

      const baseRows = (rows ?? []) as LeadListRow[];
      const crmIds = baseRows.map((row) => String(row.id));
      if (!crmIds.length) return { rows: baseRows, count: count ?? 0 };

      const [{ data: automationRows, error: automationError }, { data: queueRows, error: queueError }] = await Promise.all([
        supabase
          .from("lead")
          .select("id_crm,status,atendimento_humano")
          .in("id_crm", crmIds)
          .eq("id_empresa", companyId!),
        supabase
          .from("fila_leads")
          .select("id_lead,status")
          .in("id_lead", crmIds)
          .eq("id_empresa", companyId!),
      ]);
      if (automationError) throw automationError;
      if (queueError) throw queueError;

      const activeIds = new Set(
        [
          ...(automationRows ?? []).map((row) => Number(row.id_crm)),
          ...(queueRows ?? []).map((row) => Number(row.id_lead)),
        ].filter(Number.isFinite),
      );
      const pausedIds = new Set(
        (automationRows ?? [])
          .filter((row) => row.atendimento_humano || String(row.status ?? "").trim().toLowerCase() === "atendimento humano")
          .map((row) => Number(row.id_crm))
          .filter(Number.isFinite),
      );

      return {
        rows: baseRows.map((row) => ({
          ...row,
          ai_active: activeIds.has(row.id),
          ai_paused: pausedIds.has(row.id),
        })),
        count: count ?? 0,
      };
    },
  });

  const stageMap = new Map((meta?.stages ?? []).map((s) => [s.id, s]));
  const userMap = new Map((meta?.users ?? []).map((u) => [u.id, u.nome]));
  const empMap = new Map((meta?.emps ?? []).map((e) => [e.id, e.nome]));

  const total = data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const newToday = (data?.rows ?? []).filter((r) => r.created_at && new Date(r.created_at).getTime() >= todayStart).length;

  const activeChips: { key: string; label: string; onClear: () => void }[] = [];
  if (stage !== "all") {
    const s = meta?.stages.find((x) => String(x.id) === stage);
    if (s) activeChips.push({ key: "stage", label: `Estágio: ${s.nome}`, onClear: () => { setStage("all"); setPage(0); } });
  }
  if (tagId !== "all") {
    const t = meta?.tags.find((x) => String(x.id) === tagId);
    if (t) activeChips.push({ key: "tag", label: `Tag: ${t.nome}`, onClear: () => { setTagId("all"); setPage(0); } });
  }
  if (empId !== "all") {
    const e = meta?.emps.find((x) => String(x.id) === empId);
    if (e) activeChips.push({ key: "emp", label: `Empreendimento: ${e.nome}`, onClear: () => { setEmpId("all"); setPage(0); } });
  }
  if (userId !== "all") {
    const u = meta?.users.find((x) => x.id === userId);
    if (u) activeChips.push({ key: "user", label: `Responsável: ${u.nome}`, onClear: () => { setUserId("all"); setPage(0); } });
  }
  if (aiStatus !== "all") {
    const labels: Record<AiStatusFilter, string> = {
      all: "Todos",
      active: "Em atendimento",
      paused: "Atendimento pausado",
    };
    activeChips.push({ key: "ai-status", label: `Status: ${labels[aiStatus]}`, onClear: () => { setAiStatus("all"); setPage(0); } });
  }
  if (dateFrom) activeChips.push({ key: "from", label: `De: ${dateFrom}`, onClear: () => { setDateFrom(""); setPage(0); } });
  if (dateTo) activeChips.push({ key: "to", label: `Até: ${dateTo}`, onClear: () => { setDateTo(""); setPage(0); } });

  function clearAll() {
    setSearch("");
    setStage("all");
    setTagId("all");
    setEmpId("all");
    setUserId("all");
    setAiStatus("all");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  }

  const rows = data?.rows ?? [];
  const pageIds = rows.map((r) => r.id);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someChecked = pageIds.some((id) => selected.has(id));
  const selectionMode = selected.size > 0;

  function toggleAll(v: boolean) {
    const next = new Set(selected);
    if (v) pageIds.forEach((id) => next.add(id));
    else pageIds.forEach((id) => next.delete(id));
    setSelected(next);
  }
  function toggleOne(id: number, v: boolean) {
    const next = new Set(selected);
    if (v) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  // Mutations
  const bulkStageMut = useMutation({
    mutationFn: async ({ ids, stageId }: { ids: number[]; stageId: number }) => {
      const { data: before, error: beforeError } = await supabase
        .from("crm_leads")
        .select("id, crm_stage_id")
        .in("id", ids);
      if (beforeError) throw beforeError;

      const { error } = await supabase.from("crm_leads").update({ crm_stage_id: stageId }).in("id", ids);
      if (error) throw error;

      if (me?.id) {
        const toName = stageMap.get(stageId)?.nome ?? "—";
        const activities = (before ?? [])
          .filter((lead) => lead.crm_stage_id !== stageId)
          .map((lead) => ({
            lead_id: lead.id,
            crm_user_id: me.id,
            tipo: "stage_change",
            descricao: `De ${lead.crm_stage_id ? stageMap.get(lead.crm_stage_id)?.nome ?? "—" : "—"} para ${toName}`,
          }));
        if (activities.length) {
          await supabase.from("crm_lead_activities").insert(activities);
        }
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["leads-list"] }); toast.success("Estágio atualizado"); setBulkStageOpen(false); setRowStageLead(null); setSelected(new Set()); },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });
  const bulkUserMut = useMutation({
    mutationFn: async ({ ids, uid }: { ids: number[]; uid: string }) => {
      const { data: before, error: beforeError } = await supabase
        .from("crm_leads")
        .select("id, crm_assigned_to")
        .in("id", ids);
      if (beforeError) throw beforeError;

      const { error } = await supabase.from("crm_leads").update({ crm_assigned_to: uid }).in("id", ids);
      if (error) throw error;

      if (me?.id) {
        const toName = userMap.get(uid) ?? "—";
        const activities = (before ?? [])
          .filter((lead) => lead.crm_assigned_to !== uid)
          .map((lead) => ({
            lead_id: lead.id,
            crm_user_id: me.id,
            tipo: "assignment",
            descricao: `Responsável alterado de ${lead.crm_assigned_to ? userMap.get(lead.crm_assigned_to) ?? "—" : "—"} para ${toName}`,
          }));
        if (activities.length) {
          await supabase.from("crm_lead_activities").insert(activities);
        }
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["leads-list"] }); toast.success("Responsável atualizado"); setBulkUserOpen(false); setRowUserLead(null); setSelected(new Set()); },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });
  const bulkDeleteMut = useMutation({
    mutationFn: async (ids: number[]) => {
      const { error } = await supabase.from("crm_leads").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads-list"] });
      toast.success("Leads excluídos");
      setBulkDeleteOpen(false);
      setRowDeleteLead(null);
      setDeleteConfirmText("");
      setSelected(new Set());
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });
  const pauseAiMut = useMutation({
    mutationFn: async (leadId: number) => {
      const { error } = await (supabase as any).rpc("crm_pause_ai_attendance", {
        p_lead_id: leadId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads-list"] });
      qc.invalidateQueries({ queryKey: ["lead-activities"] });
      toast.success("Atendimento da IA pausado");
      setRowPauseAiLead(null);
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });
  const startAiMut = useMutation({
    mutationFn: async (leadId: number) => {
      const { data: lead, error: leadError } = await supabase
        .from("crm_leads")
        .select("id, id_empresa, id_empreendimento")
        .eq("id", leadId)
        .single();
      if (leadError) throw leadError;
      if (!lead.id_empreendimento) {
        throw new Error("Defina o empreendimento de interesse antes de enviar este lead para atendimento da IA.");
      }

      const [{ data: automationRows, error: automationError }, { data: queueRows, error: queueError }] = await Promise.all([
        supabase
          .from("lead")
          .select("id")
          .eq("id_crm", String(lead.id))
          .eq("id_empresa", lead.id_empresa)
          .limit(1),
        supabase
          .from("fila_leads")
          .select("id")
          .eq("id_lead", String(lead.id))
          .eq("id_empresa", lead.id_empresa)
          .limit(1),
      ]);
      if (automationError) throw automationError;
      if (queueError) throw queueError;
      if ((automationRows?.length ?? 0) > 0 || (queueRows?.length ?? 0) > 0) {
        throw new Error("Este lead já está na fila ou em atendimento da IA.");
      }

      const { error: queueInsertError } = await supabase.from("fila_leads").insert({
        id_lead: String(lead.id),
        crm_provider: "Hub",
        id_empresa: lead.id_empresa,
        id_empreendimento: lead.id_empreendimento,
        verificado: 0,
        status: "pending",
      });
      if (queueInsertError) throw queueInsertError;

      if (me?.id) {
        const { error: activityError } = await supabase
          .from("crm_lead_activities")
          .insert({
            lead_id: lead.id,
            crm_user_id: me.id,
            tipo: "whatsapp_automation",
            descricao:
              "Atendimento da IA iniciado manualmente.\nLead enviado para a fila de atendimento.",
            metadata: {
              source: "crm",
              event: "ai_service_started_manually",
              id_empreendimento: lead.id_empreendimento,
            },
          });
        if (activityError) throw activityError;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads-list"] });
      qc.invalidateQueries({ queryKey: ["lead-activities"] });
      toast.success("Lead enviado para Atendimento IA");
      setRowStartAiLead(null);
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  function exportCsv(ids: number[]) {
    const list = rows.filter((r) => ids.includes(r.id));
    const header = ["id", "nome", "telefone", "email", "responsavel", "estagio", "empreendimento", "criado_em"];
    const lines = [header.join(";")];
    for (const l of list) {
      const s = l.crm_stage_id ? stageMap.get(l.crm_stage_id)?.nome ?? "" : "";
      const r = l.crm_assigned_to ? userMap.get(l.crm_assigned_to) ?? "" : "";
      const e = l.id_empreendimento ? empMap.get(l.id_empreendimento) ?? "" : "";
      const row = [l.id, l.nome ?? "", l.telefone ?? "", l.email ?? "", r, s, e, l.created_at ?? ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(";");
      lines.push(row);
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyHistoryLink(lead: LeadListRow) {
    const ref = lead.historico_token ?? String(lead.id);
    const url = `${window.location.origin}/historico/${ref}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link do histórico copiado");
  }

  return (
    <div className="space-y-5">
        {/* Header */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight text-foreground">Leads</h1>
            <p className="text-sm text-muted-foreground mt-1">
              <span className="font-medium text-foreground">{total}</span> leads no total
              {newToday > 0 && (
                <>
                  {" · "}
                  <span className="font-medium text-primary">{newToday}</span> novos hoje
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {me?.role === "super_admin" && (
              <Button asChild variant="outline" className="rounded-lg">
                <Link to="/leads/importar"><Upload className="h-4 w-4 mr-1" /> Importar leads</Link>
              </Button>
            )}
            {me?.role === "super_admin" && <Button asChild className="rounded-lg shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] hover:shadow-primary/40"><Link to="/leads/new"><Plus className="h-4 w-4 mr-1" /> Novo Lead</Link></Button>}
          </div>
        </div>

        {/* Search + View toggle */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9 h-10 bg-white border-border/80"
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            />
          </div>
          <div
            className="flex items-center rounded-lg border p-1 gap-1"
            style={{ backgroundColor: "#FFFFFF", borderColor: "var(--border)" }}
          >
            <button
              onClick={() => setView("list")}
              className={cn(
                "h-8 w-8 flex cursor-pointer items-center justify-center rounded-md transition-colors",
                view === "list" ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              style={view === "list" ? { backgroundColor: "rgba(193,79,33,0.12)" } : undefined}
              aria-label="Visualização em lista"
              title="Visualização em lista"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView("kanban")}
              className={cn(
                "h-8 w-8 flex cursor-pointer items-center justify-center rounded-md transition-colors",
                view === "kanban" ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              style={view === "kanban" ? { backgroundColor: "rgba(193,79,33,0.12)" } : undefined}
              aria-label="Visualização em kanban"
              title="Visualização em kanban"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div
          className="rounded-xl border p-3 space-y-3"
          style={{ backgroundColor: "#FFFFFF", borderColor: "var(--border)" }}
        >
          <div className="flex flex-wrap items-end gap-3">
            {me?.role === "super_admin" && (
              <LabeledFilter label="Empresa">
                <FilterSelect
                  value={companyId == null ? "" : String(companyId)}
                  onChange={(value) => setCompanyId(Number(value))}
                  placeholder="Selecione a empresa"
                  options={companies.map((company) => ({ value: String(company.id), label: company.nome }))}
                />
              </LabeledFilter>
            )}
            <LabeledFilter label="Estágio">
              <FilterSelect value={stage} onChange={(v) => { setStage(v); setPage(0); }} placeholder="Estágio" options={[{ value: "all", label: "Todos os estágios" }, ...(meta?.stages ?? []).map((s) => ({ value: String(s.id), label: s.nome }))]} />
            </LabeledFilter>
            {me?.role !== "agent" && (
              <LabeledFilter label="Responsável">
                <FilterSelect value={userId} onChange={(v) => { setUserId(v); setPage(0); }} placeholder="Responsável" options={[{ value: "all", label: "Todos" }, ...(meta?.users ?? []).map((u) => ({ value: u.id, label: u.nome }))]} />
              </LabeledFilter>
            )}
            <LabeledFilter label="Empreendimento">
              <FilterSelect value={empId} onChange={(v) => { setEmpId(v); setPage(0); }} placeholder="Empreendimento" options={[{ value: "all", label: "Todos" }, ...(meta?.emps ?? []).map((e) => ({ value: String(e.id), label: e.nome }))]} />
            </LabeledFilter>
            <LabeledFilter label="Tag">
              <FilterSelect value={tagId} onChange={(v) => { setTagId(v); setPage(0); }} placeholder="Tag" options={[{ value: "all", label: "Todas" }, ...(meta?.tags ?? []).map((t) => ({ value: String(t.id), label: t.nome }))]} />
            </LabeledFilter>
            <LabeledFilter label="Status">
              <FilterSelect
                value={aiStatus}
                onChange={(v) => { setAiStatus(v as AiStatusFilter); setPage(0); }}
                placeholder="Status"
                options={[
                  { value: "all", label: "Todos" },
                  { value: "active", label: "Em atendimento" },
                  { value: "paused", label: "Atendimento pausado" },
                ]}
              />
            </LabeledFilter>
            <LabeledFilter label="Período">
              <div className="flex items-center gap-1.5">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "h-9 w-[125px] justify-start text-left font-normal text-xs bg-white border-border hover:bg-surface",
                        !dateFrom && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                      {dateFrom ? format(new Date(dateFrom + "T12:00:00"), "dd/MM/yyyy") : <span>De:</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateFrom ? new Date(dateFrom + "T12:00:00") : undefined}
                      onSelect={(d) => { if (d) { setDateFrom(format(d, "yyyy-MM-dd")); setPage(0); } }}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
                <span className="text-muted-foreground">→</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "h-9 w-[125px] justify-start text-left font-normal text-xs bg-white border-border hover:bg-surface",
                        !dateTo && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                      {dateTo ? format(new Date(dateTo + "T12:00:00"), "dd/MM/yyyy") : <span>Até:</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateTo ? new Date(dateTo + "T12:00:00") : undefined}
                      onSelect={(d) => { if (d) { setDateTo(format(d, "yyyy-MM-dd")); setPage(0); } }}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </LabeledFilter>
          </div>

          {(activeChips.length > 0 || search) && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              {search && (
                <Chip label={`Busca: "${search}"`} onClear={() => { setSearch(""); setPage(0); }} />
              )}
              {activeChips.map((c) => (
                <Chip key={c.key} label={c.label} onClear={c.onClear} />
              ))}
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground ml-auto" onClick={clearAll}>
                Limpar tudo
              </Button>
            </div>
          )}
        </div>

        {view === "kanban" ? (
          <KanbanView searchFilter={search} funnelId={funnelId} idEmpresa={companyId} />
        ) : (
          <>
            {/* Bulk action bar */}
            {selectionMode && (
              <div
                className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2"
                style={{ backgroundColor: "rgba(193,79,33,0.08)", borderColor: "rgba(193,79,33,0.3)" }}
              >
                <span className="text-sm font-medium text-foreground mr-2">
                  {selected.size} {selected.size === 1 ? "lead selecionado" : "leads selecionados"}
                </span>
                {me?.role === "super_admin" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => { setPickStage(""); setBulkStageOpen(true); }}><ArrowRightLeft className="h-3.5 w-3.5 mr-1" /> Alterar estágio</Button>
                    <Button size="sm" variant="outline" onClick={() => { setPickUser(""); setBulkUserOpen(true); }}><UserCog className="h-3.5 w-3.5 mr-1" /> Redistribuir</Button>
                  </>
                )}
                <Button size="sm" variant="outline" onClick={() => exportCsv(Array.from(selected))}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Exportar selecionados
                </Button>
                {me?.role === "super_admin" && <Button size="sm" variant="outline" className="text-destructive hover:text-destructive border-destructive/40" onClick={() => setBulkDeleteOpen(true)}><Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir selecionados</Button>}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
                  <X className="h-3.5 w-3.5 mr-1" /> Cancelar seleção
                </Button>
              </div>
            )}

            {/* Table */}
            <div
              className="rounded-xl border overflow-hidden group/table"
              style={{ backgroundColor: "#FFFFFF", borderColor: "var(--border)" }}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                    <th className="w-10 pl-4">
                      <div className={cn("transition-opacity", selectionMode ? "opacity-100" : "opacity-0 group-hover/table:opacity-100")}>
                        <Checkbox
                          checked={allChecked ? true : someChecked ? "indeterminate" : false}
                          onCheckedChange={(v) => toggleAll(!!v)}
                          aria-label="Selecionar todos"
                        />
                      </div>
                    </th>
                    <Th className="w-20">ID</Th>
                    <Th>Nome</Th>
                    <Th>Telefone</Th>
                    <Th className="hidden md:table-cell">Empreendimento</Th>
                    <Th>Responsável</Th>
                    <Th>Estágio</Th>
                    <Th className="hidden lg:table-cell">Criado</Th>
                    <Th className="text-right pr-4">Ações</Th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b" style={{ borderColor: "var(--border)" }}>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <td key={j} className="px-4 py-4"><Skeleton className="h-5 w-full max-w-[160px]" /></td>
                      ))}
                    </tr>
                  ))}
                  {!isLoading && !data?.rows.length && (
                    <tr>
                      <td colSpan={9} className="px-4 py-16">
                        <div className="flex flex-col items-center text-center gap-4">
                          <div className="h-16 w-16 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(193,79,33,0.1)" }}>
                            <UsersIcon className="h-7 w-7 text-primary" />
                          </div>
                          <div>
                            <div className="font-semibold text-foreground">Nenhum lead encontrado</div>
                            <div className="text-sm text-muted-foreground mt-1">Ajuste os filtros ou crie um novo lead para começar.</div>
                          </div>
                          <div className="flex gap-2">
                            {(activeChips.length > 0 || search) && (
                              <Button variant="outline" size="sm" onClick={clearAll}>Limpar filtros</Button>
                            )}
                            {me?.role === "super_admin" && <Button asChild size="sm"><Link to="/leads/new"><Plus className="h-4 w-4 mr-1" /> Novo lead</Link></Button>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {!isLoading && data?.rows.map((l) => {
                    const s = l.crm_stage_id ? stageMap.get(l.crm_stage_id) : undefined;
                    const sColor = stageColor(s?.nome, s?.cor);
                    const responsavel = l.crm_assigned_to ? userMap.get(l.crm_assigned_to) : null;
                    const isChecked = selected.has(l.id);
                    return (
                      <tr
                        key={l.id}
                        className={cn(
                          "group/row border-b transition-colors hover:bg-[var(--primary-50)]",
                          l.ai_paused && "bg-amber-50/70 hover:bg-amber-50",
                          isChecked && "bg-[var(--primary-50)]",
                        )}
                        style={{ borderColor: "var(--border)" }}
                      >
                        <td className="pl-4 w-10">
                          <div className={cn("transition-opacity", isChecked || selectionMode ? "opacity-100" : "opacity-0 group-hover/row:opacity-100")}>
                            <Checkbox checked={isChecked} onCheckedChange={(v) => toggleOne(l.id, !!v)} aria-label="Selecionar lead" />
                          </div>
                        </td>
                        <td className="px-4 py-4 text-xs font-medium text-muted-foreground">
                          #{l.id}
                        </td>
                        <td className="px-4 py-4">
                          <Link to="/leads/$id" params={{ id: String(l.id) }} className="group">
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="truncate font-semibold text-foreground transition-colors group-hover:text-primary">{l.nome ?? "—"}</div>
                                {l.ai_paused && (
                                  <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                    Pausado
                                  </span>
                                )}
                              </div>
                              {l.email && <div className="text-xs text-muted-foreground truncate">{l.email}</div>}
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">{l.telefone ?? "—"}</td>
                        <td className="px-4 py-4 hidden md:table-cell text-muted-foreground">
                          {l.id_empreendimento ? empMap.get(l.id_empreendimento) ?? "—" : "Sem interesse"}
                        </td>
                        <td className="px-4 py-4">
                          {responsavel ? (
                            <span className="text-sm text-foreground truncate">{responsavel}</span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-4">
                          {s ? (
                            <span
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
                              style={{ backgroundColor: `${sColor}1F`, color: sColor, borderColor: `${sColor}40` }}
                            >
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: sColor }} />
                              {s.nome}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-4 hidden lg:table-cell">
                          <span className="text-xs text-muted-foreground">
                            {formatLeadCreatedAt(l.created_at)}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className={cn("inline-flex items-center gap-1 justify-end", selectionMode && "opacity-30 pointer-events-none")}>
                            <button
                              onClick={() => navigate({ to: "/conversas", search: { lead: String(l.id) } })}
                              className="h-7 w-7 cursor-pointer rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 opacity-0 group-hover/row:opacity-100 transition-opacity"
                              title="Ver conversa"
                              aria-label="Ver conversa"
                            >
                              <MessagesSquare className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => copyHistoryLink(l)}
                              className="h-7 w-7 cursor-pointer rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 opacity-0 group-hover/row:opacity-100 transition-opacity"
                              title="Copiar link do histórico"
                              aria-label="Copiar link do histórico"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="h-7 w-7 cursor-pointer rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/5"
                                  aria-label="Mais ações"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem onClick={() => navigate({ to: "/leads/$id", params: { id: String(l.id) } })}>
                                  <Eye className="h-4 w-4 mr-2" /> Ver detalhes
                                </DropdownMenuItem>
                                {me?.role === "super_admin" && (<>
                                  <DropdownMenuItem onClick={() => navigate({ to: "/leads/$id", params: { id: String(l.id) } })}><Pencil className="h-4 w-4 mr-2" /> Editar</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setPickStage(""); setRowStageLead(l.id); }}><ArrowRightLeft className="h-4 w-4 mr-2" /> Alterar estágio</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setPickUser(""); setRowUserLead(l.id); }}>
                                    <UserCog className="h-4 w-4 mr-2" /> Redistribuir responsável
                                  </DropdownMenuItem>
                                </>)}
                                {(me?.role === "super_admin" || me?.role === "manager") && (l.ai_paused ? (
                                  <DropdownMenuItem disabled>
                                    <PauseCircle className="h-4 w-4 mr-2" /> Atendimento da IA pausado
                                  </DropdownMenuItem>
                                ) : l.ai_active ? (
                                  <DropdownMenuItem onClick={() => setRowPauseAiLead(l.id)}>
                                    <PauseCircle className="h-4 w-4 mr-2" /> Pausar Atendimento da IA
                                  </DropdownMenuItem>
                                ) : me?.role === "super_admin" ? (
                                  <DropdownMenuItem onClick={() => setRowStartAiLead(l.id)}>
                                    <Bot className="h-4 w-4 mr-2" /> Enviar para Atendimento IA
                                  </DropdownMenuItem>
                                ) : null)}
                                {me?.role === "super_admin" && (<>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setRowDeleteLead(l.id)}><Trash2 className="h-4 w-4 mr-2" /> Excluir</DropdownMenuItem>
                                </>)}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Página <span className="font-medium text-foreground">{page + 1}</span> de <span className="font-medium text-foreground">{pages}</span>
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Bulk: alterar estágio */}
        <Dialog open={bulkStageOpen || rowStageLead != null} onOpenChange={(o) => { if (!o) { setBulkStageOpen(false); setRowStageLead(null); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Alterar estágio</DialogTitle>
              <DialogDescription>
                {rowStageLead != null ? "Selecione o novo estágio para este lead." : `Selecione o novo estágio para ${selected.size} lead(s).`}
              </DialogDescription>
            </DialogHeader>
            <Select value={pickStage} onValueChange={setPickStage}>
              <SelectTrigger><SelectValue placeholder="Selecione um estágio" /></SelectTrigger>
              <SelectContent>
                {(meta?.stages ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setBulkStageOpen(false); setRowStageLead(null); }}>Cancelar</Button>
              <Button
                disabled={!pickStage || bulkStageMut.isPending}
                onClick={() => {
                  const ids = rowStageLead != null ? [rowStageLead] : Array.from(selected);
                  bulkStageMut.mutate({ ids, stageId: Number(pickStage) });
                }}
              >Aplicar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulk: redistribuir */}
        <Dialog open={bulkUserOpen || rowUserLead != null} onOpenChange={(o) => { if (!o) { setBulkUserOpen(false); setRowUserLead(null); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Redistribuir responsável</DialogTitle>
              <DialogDescription>
                {rowUserLead != null ? "Selecione o novo responsável." : `Selecione o novo responsável para ${selected.size} lead(s).`}
              </DialogDescription>
            </DialogHeader>
            <Select value={pickUser} onValueChange={setPickUser}>
              <SelectTrigger><SelectValue placeholder="Selecione um responsável" /></SelectTrigger>
              <SelectContent>
                {(meta?.users ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setBulkUserOpen(false); setRowUserLead(null); }}>Cancelar</Button>
              <Button
                disabled={!pickUser || bulkUserMut.isPending}
                onClick={() => {
                  const ids = rowUserLead != null ? [rowUserLead] : Array.from(selected);
                  bulkUserMut.mutate({ ids, uid: pickUser });
                }}
              >Aplicar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Linha: pausar IA */}
        <Dialog
          open={rowPauseAiLead != null}
          onOpenChange={(open) => {
            if (!open) setRowPauseAiLead(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Pausar Atendimento da IA?</DialogTitle>
              <DialogDescription>
                Ao confirmar, o envio de follow-ups para este lead será interrompido e o atendimento será marcado como humano.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Esta ação altera o status do lead na automação para <strong>Atendimento Humano</strong> e registra a pausa no histórico do lead.
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRowPauseAiLead(null)}>
                Cancelar
              </Button>
              <Button
                disabled={pauseAiMut.isPending || rowPauseAiLead == null}
                onClick={() => {
                  if (rowPauseAiLead != null) pauseAiMut.mutate(rowPauseAiLead);
                }}
              >
                {pauseAiMut.isPending ? "Pausando..." : "Confirmar pausa"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Linha: iniciar IA */}
        <Dialog
          open={rowStartAiLead != null}
          onOpenChange={(open) => {
            if (!open) setRowStartAiLead(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Enviar para Atendimento IA?</DialogTitle>
              <DialogDescription>
                Ao confirmar, este lead será enviado para a fila de atendimento e a IA irá iniciar o atendimento conforme o fluxo configurado.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-foreground">
              Confirme apenas se o lead deve entrar no atendimento automático. O envio será registrado no histórico do lead.
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRowStartAiLead(null)}>
                Cancelar
              </Button>
              <Button
                disabled={startAiMut.isPending || rowStartAiLead == null}
                onClick={() => {
                  if (rowStartAiLead != null) startAiMut.mutate(rowStartAiLead);
                }}
              >
                {startAiMut.isPending ? "Enviando..." : "Confirmar envio"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulk/linha: excluir */}
        <Dialog
          open={bulkDeleteOpen || rowDeleteLead != null}
          onOpenChange={(open) => {
            if (!open) {
              setBulkDeleteOpen(false);
              setRowDeleteLead(null);
              setDeleteConfirmText("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{rowDeleteLead != null ? "Excluir lead?" : "Excluir leads?"}</DialogTitle>
              <DialogDescription>
                {rowDeleteLead != null ? (
                  <>
                    Esta ação não pode ser desfeita. Digite{" "}
                    <strong>deletar{rowDeleteLead}</strong> para confirmar.
                  </>
                ) : (
                  <>Esta ação não pode ser desfeita. Serão excluídos {selected.size} lead(s).</>
                )}
              </DialogDescription>
            </DialogHeader>

            {rowDeleteLead != null && (
              <Input
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                placeholder={`deletar${rowDeleteLead}`}
              />
            )}

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setBulkDeleteOpen(false);
                  setRowDeleteLead(null);
                  setDeleteConfirmText("");
                }}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                disabled={
                  bulkDeleteMut.isPending ||
                  (rowDeleteLead != null && deleteConfirmText !== `deletar${rowDeleteLead}`)
                }
                onClick={() => bulkDeleteMut.mutate(rowDeleteLead != null ? [rowDeleteLead] : Array.from(selected))}
              >
                {bulkDeleteMut.isPending ? "Excluindo..." : "Excluir"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}

function formatLeadCreatedAt(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date
    .toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", "");
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-3 text-left text-[11px] uppercase tracking-wider font-semibold text-muted-foreground ${className ?? ""}`}>
      {children}
    </th>
  );
}

function LabeledFilter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground px-0.5">{label}</span>
      {children}
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full text-xs font-medium border border-border/80 bg-white text-foreground/90"
    >
      {label}
      <button
        onClick={onClear}
        className="h-4 w-4 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
        aria-label="Remover filtro"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-auto min-w-[140px] bg-white">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
