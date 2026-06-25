import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, Plus, X, Users as UsersIcon, List, LayoutGrid, MoreHorizontal, Pencil, Eye, ArrowRightLeft, UserCog, Trash2, Download, CalendarIcon, Upload, PauseCircle } from "lucide-react";

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
  ai_paused?: boolean;
};

function onlyDigits(s?: string | null) {
  return (s ?? "").replace(/\D/g, "");
}

function LeadsList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useCrmUser();
  const { data: allowed } = useAllowedEmpresas();
  const { data: funnels = [] } = useFunnels(me?.id_empresa);
  const [funnelId, setFunnelId] = useState<number | null>(null);
  useEffect(() => {
    if (funnelId == null && funnels.length) {
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
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);

  // Bulk selection
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => { setSelected(new Set()); }, [page, funnelId, stage, tagId, empId, userId, dateFrom, dateTo, search]);

  // Dialogs
  const [bulkStageOpen, setBulkStageOpen] = useState(false);
  const [bulkUserOpen, setBulkUserOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [rowStageLead, setRowStageLead] = useState<number | null>(null);
  const [rowUserLead, setRowUserLead] = useState<number | null>(null);
  const [rowDeleteLead, setRowDeleteLead] = useState<number | null>(null);
  const [rowPauseAiLead, setRowPauseAiLead] = useState<number | null>(null);
  const [pickStage, setPickStage] = useState<string>("");
  const [pickUser, setPickUser] = useState<string>("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const filters = useMemo(
    () => ({ search, stage, tagId, empId, userId, dateFrom, dateTo, page }),
    [search, stage, tagId, empId, userId, dateFrom, dateTo, page],
  );

  const { data: meta } = useQuery({
    enabled: !!me && !!allowed && funnelId != null,
    queryKey: ["leads-meta", me?.id_empresa, allowed, funnelId],
    queryFn: async () => {
      const [{ data: stages }, { data: tags }, { data: emps }, { data: users }] = await Promise.all([
        supabase.from("crm_stages").select("id, nome, cor").eq("ativo", true).eq("id_funnel", funnelId!).order("ordem"),
        supabase.from("crm_tags").select("id, nome, cor"),
        supabase.from("empreendimento").select("id, nome").in("id_empresa", allowed ?? []),
        supabase.from("crm_users").select("id, nome").eq("active", true).in("id_empresa", allowed ?? []),
      ]);
      return { stages: stages ?? [], tags: tags ?? [], emps: emps ?? [], users: users ?? [] };
    },
  });

  const { data, isLoading } = useQuery({
    enabled: !!me && !!allowed && !!meta,
    queryKey: ["leads-list", me?.id, me?.role, filters, allowed, funnelId, (meta?.stages ?? []).map((s) => s.id).join(",")],
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

      let q = supabase
        .from("crm_leads")
        .select("id, nome, telefone, email, crm_stage_id, crm_assigned_to, id_empreendimento, created_at", { count: "exact" })
        .in("id_empresa", allowed ?? []);

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

      q = q.order("created_at", { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data: rows, count, error } = await q;
      if (error) throw error;

      const baseRows = (rows ?? []) as LeadListRow[];
      const crmIds = baseRows.map((row) => String(row.id));
      if (!crmIds.length) return { rows: baseRows, count: count ?? 0 };

      const { data: automationRows, error: automationError } = await supabase
        .from("lead")
        .select("id_crm,status,atendimento_humano")
        .in("id_crm", crmIds)
        .in("id_empresa", allowed ?? []);
      if (automationError) throw automationError;

      const pausedIds = new Set(
        (automationRows ?? [])
          .filter((row) => row.atendimento_humano || String(row.status ?? "").trim().toLowerCase() === "atendimento humano")
          .map((row) => Number(row.id_crm))
          .filter(Number.isFinite),
      );

      return {
        rows: baseRows.map((row) => ({ ...row, ai_paused: pausedIds.has(row.id) })),
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
  if (dateFrom) activeChips.push({ key: "from", label: `De: ${dateFrom}`, onClear: () => { setDateFrom(""); setPage(0); } });
  if (dateTo) activeChips.push({ key: "to", label: `Até: ${dateTo}`, onClear: () => { setDateTo(""); setPage(0); } });

  function clearAll() {
    setSearch("");
    setStage("all");
    setTagId("all");
    setEmpId("all");
    setUserId("all");
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
      const { data: lead, error: leadError } = await supabase
        .from("crm_leads")
        .select("id, id_empresa")
        .eq("id", leadId)
        .single();
      if (leadError) throw leadError;

      const now = new Date().toISOString();
      const { data: updatedLeadRows, error: updateError } = await supabase
        .from("lead")
        .update({
          status: "Atendimento Humano",
          atendimento_humano: true,
          updated_at: now,
        })
        .eq("id_crm", String(lead.id))
        .eq("id_empresa", lead.id_empresa)
        .select("id");
      if (updateError) throw updateError;
      if (!updatedLeadRows?.length) {
        throw new Error("Nenhum atendimento da IA foi encontrado para este lead.");
      }

      if (me?.id) {
        const { error: activityError } = await supabase
          .from("crm_lead_activities")
          .insert({
            lead_id: lead.id,
            crm_user_id: me.id,
            tipo: "whatsapp_automation",
            descricao:
              "[AUTOMAÇÃO WHATSAPP]\n\nAtendimento da IA pausado.\nEnvio de follow-ups para este lead interrompido.",
            metadata: {
              source: "crm",
              event: "ai_followups_paused",
              external_lead_ids: updatedLeadRows.map((row) => row.id),
            },
          });
        if (activityError) throw activityError;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads-list"] });
      qc.invalidateQueries({ queryKey: ["lead-activities"] });
      toast.success("Atendimento da IA pausado");
      setRowPauseAiLead(null);
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
            {funnels.length > 0 && (
              <Select value={funnelId ? String(funnelId) : ""} onValueChange={(v) => { setFunnelId(Number(v)); setPage(0); setStage("all"); }}>
                <SelectTrigger className="h-9 w-[200px] bg-white">
                  <SelectValue placeholder="Funil" />
                </SelectTrigger>
                <SelectContent>
                  {funnels.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.nome}{f.is_default ? " (padrão)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              asChild
              variant="outline"
              className="rounded-lg"
            >
              <Link to="/leads/importar">
                <Upload className="h-4 w-4 mr-1" /> Importar leads
              </Link>
            </Button>
            <Button
            asChild
            className="rounded-lg shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] hover:shadow-primary/40"
          >
            <Link to="/leads/new">
              <Plus className="h-4 w-4 mr-1" /> Novo Lead
            </Link>
          </Button>
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
          <KanbanView searchFilter={search} funnelId={funnelId} />
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
                <Button size="sm" variant="outline" onClick={() => { setPickStage(""); setBulkStageOpen(true); }}>
                  <ArrowRightLeft className="h-3.5 w-3.5 mr-1" /> Alterar estágio
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setPickUser(""); setBulkUserOpen(true); }}>
                  <UserCog className="h-3.5 w-3.5 mr-1" /> Redistribuir
                </Button>
                <Button size="sm" variant="outline" onClick={() => exportCsv(Array.from(selected))}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Exportar selecionados
                </Button>
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive border-destructive/40" onClick={() => setBulkDeleteOpen(true)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir selecionados
                </Button>
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
                            <Button asChild size="sm">
                              <Link to="/leads/new"><Plus className="h-4 w-4 mr-1" /> Novo lead</Link>
                            </Button>
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
                    const waNumber = onlyDigits(l.telefone);
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
                            {waNumber && (
                              <a
                                href={`https://wa.me/${waNumber}`}
                                target="_blank"
                                rel="noreferrer"
                                className="h-7 w-7 rounded-md inline-flex items-center justify-center text-emerald-400 hover:bg-emerald-500/10 opacity-0 group-hover/row:opacity-100 transition-opacity"
                                title="Abrir WhatsApp"
                                aria-label="Abrir WhatsApp"
                              >
                                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.693.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.04 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.999-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.889-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.892 6.994c-.003 5.45-4.437 9.884-9.886 9.884zm8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.49-8.413z"/>
                                </svg>
                              </a>
                            )}
                            <button
                              onClick={() => navigate({ to: "/leads/$id", params: { id: String(l.id) } })}
                              className="h-7 w-7 cursor-pointer rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/5 opacity-0 group-hover/row:opacity-100 transition-opacity"
                              title="Editar"
                              aria-label="Editar"
                            >
                              <Pencil className="h-3.5 w-3.5" />
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
                                <DropdownMenuItem onClick={() => navigate({ to: "/leads/$id", params: { id: String(l.id) } })}>
                                  <Pencil className="h-4 w-4 mr-2" /> Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => { setPickStage(""); setRowStageLead(l.id); }}>
                                  <ArrowRightLeft className="h-4 w-4 mr-2" /> Alterar estágio
                                </DropdownMenuItem>
                                {me?.role !== "agent" && (
                                  <DropdownMenuItem onClick={() => { setPickUser(""); setRowUserLead(l.id); }}>
                                    <UserCog className="h-4 w-4 mr-2" /> Redistribuir responsável
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => setRowPauseAiLead(l.id)}>
                                  <PauseCircle className="h-4 w-4 mr-2" /> Pausar Atendimento da IA
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setRowDeleteLead(l.id)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" /> Excluir
                                </DropdownMenuItem>
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
