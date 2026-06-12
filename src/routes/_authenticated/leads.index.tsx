import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Search, Plus, X, Users as UsersIcon, List, LayoutGrid } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, colorFromString, stageColor, relativeTime } from "@/lib/lead-visuals";
import { KanbanView } from "@/components/kanban-view";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/leads/")({
  component: LeadsList,
});

const PAGE_SIZE = 25;

function LeadsList() {
  const { data: me } = useCrmUser();
  const { data: allowed } = useAllowedEmpresas();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "kanban">("list");
  const [stage, setStage] = useState<string>("all");
  const [tagId, setTagId] = useState<string>("all");
  const [empId, setEmpId] = useState<string>("all");
  const [userId, setUserId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);

  const filters = useMemo(
    () => ({ search, stage, tagId, empId, userId, dateFrom, dateTo, page }),
    [search, stage, tagId, empId, userId, dateFrom, dateTo, page],
  );

  const { data: meta } = useQuery({
    enabled: !!me && !!allowed,
    queryKey: ["leads-meta", me?.id_empresa, allowed],
    queryFn: async () => {
      const [{ data: stages }, { data: tags }, { data: emps }, { data: users }] = await Promise.all([
        supabase.from("crm_stages").select("id, nome, cor").eq("ativo", true).order("ordem"),
        supabase.from("crm_tags").select("id, nome, cor"),
        supabase.from("empreendimento").select("id, nome").in("id_empresa", allowed ?? []),
        supabase.from("crm_users").select("id, nome").in("id_empresa", allowed ?? []),
      ]);
      return { stages: stages ?? [], tags: tags ?? [], emps: emps ?? [], users: users ?? [] };
    },
  });

  const { data, isLoading } = useQuery({
    enabled: !!me && !!allowed,
    queryKey: ["leads-list", me?.id, me?.role, filters, allowed],
    queryFn: async () => {
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
        .from("lead")
        .select("id, nome, numero, email, crm_stage_id, crm_assigned_to, id_empreendimento, created_at", { count: "exact" })
        .in("id_empresa", allowed ?? []);

      if (me?.role === "agent") q = q.eq("crm_assigned_to", me.id);
      if (stage !== "all") q = q.eq("crm_stage_id", Number(stage));
      if (empId !== "all") q = q.eq("id_empreendimento", Number(empId));
      if (userId !== "all") q = q.eq("crm_assigned_to", userId);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo) q = q.lte("created_at", `${dateTo}T23:59:59`);
      if (search) q = q.or(`nome.ilike.%${search}%,numero.ilike.%${search}%`);
      if (leadIdsByTag) q = q.in("id", leadIdsByTag);

      q = q.order("created_at", { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data: rows, count, error } = await q;
      if (error) throw error;

      const leadIds = (rows ?? []).map((r) => r.id);
      const { data: tagLinks } = leadIds.length
        ? await supabase.from("crm_lead_tags").select("lead_id, tag_id").in("lead_id", leadIds)
        : { data: [] as { lead_id: number; tag_id: number }[] };
      const tagByLead = new Map<number, number[]>();
      for (const t of tagLinks ?? []) {
        const arr = tagByLead.get(t.lead_id) ?? [];
        arr.push(t.tag_id);
        tagByLead.set(t.lead_id, arr);
      }
      return { rows: (rows ?? []).map((r) => ({ ...r, tagIds: tagByLead.get(r.id) ?? [] })), count: count ?? 0 };
    },
  });

  const stageMap = new Map((meta?.stages ?? []).map((s) => [s.id, s]));
  const userMap = new Map((meta?.users ?? []).map((u) => [u.id, u.nome]));
  const empMap = new Map((meta?.emps ?? []).map((e) => [e.id, e.nome]));
  const tagMap = new Map((meta?.tags ?? []).map((t) => [t.id, t]));

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
    if (s) activeChips.push({ key: "stage", label: `📌 ${s.nome}`, onClear: () => { setStage("all"); setPage(0); } });
  }
  if (tagId !== "all") {
    const t = meta?.tags.find((x) => String(x.id) === tagId);
    if (t) activeChips.push({ key: "tag", label: `🏷 ${t.nome}`, onClear: () => { setTagId("all"); setPage(0); } });
  }
  if (empId !== "all") {
    const e = meta?.emps.find((x) => String(x.id) === empId);
    if (e) activeChips.push({ key: "emp", label: `🏢 ${e.nome}`, onClear: () => { setEmpId("all"); setPage(0); } });
  }
  if (userId !== "all") {
    const u = meta?.users.find((x) => x.id === userId);
    if (u) activeChips.push({ key: "user", label: `👤 ${u.nome}`, onClear: () => { setUserId("all"); setPage(0); } });
  }
  if (dateFrom) activeChips.push({ key: "from", label: `De ${dateFrom}`, onClear: () => { setDateFrom(""); setPage(0); } });
  if (dateTo) activeChips.push({ key: "to", label: `Até ${dateTo}`, onClear: () => { setDateTo(""); setPage(0); } });

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

  return (
    <TooltipProvider delayDuration={200}>
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
          <Button
            asChild
            className="rounded-lg shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] hover:shadow-primary/40"
          >
            <Link to="/leads/new">
              <Plus className="h-4 w-4 mr-1" /> Novo Lead
            </Link>
          </Button>
        </div>

        {/* Search + View toggle */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9 h-10 bg-background/40 border-border/80"
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            />
          </div>
          <div
            className="flex items-center rounded-lg border p-1 gap-1"
            style={{ backgroundColor: "#1A1D27", borderColor: "#2A2D3A" }}
          >
            <button
              onClick={() => setView("list")}
              className={cn(
                "h-8 w-8 flex items-center justify-center rounded-md transition-colors",
                view === "list" ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              style={view === "list" ? { backgroundColor: "rgba(249,115,22,0.12)" } : undefined}
              aria-label="Visualização em lista"
              title="Visualização em lista"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView("kanban")}
              className={cn(
                "h-8 w-8 flex items-center justify-center rounded-md transition-colors",
                view === "kanban" ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              style={view === "kanban" ? { backgroundColor: "rgba(249,115,22,0.12)" } : undefined}
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
          style={{ backgroundColor: "#1A1D27", borderColor: "#2A2D3A" }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect value={stage} onChange={(v) => { setStage(v); setPage(0); }} placeholder="Estágio" options={[{ value: "all", label: "Todos os estágios" }, ...(meta?.stages ?? []).map((s) => ({ value: String(s.id), label: s.nome }))]} />
            <FilterSelect value={empId} onChange={(v) => { setEmpId(v); setPage(0); }} placeholder="Empreendimento" options={[{ value: "all", label: "Todos" }, ...(meta?.emps ?? []).map((e) => ({ value: String(e.id), label: e.nome }))]} />
            {me?.role !== "agent" && (
              <FilterSelect value={userId} onChange={(v) => { setUserId(v); setPage(0); }} placeholder="Corretor" options={[{ value: "all", label: "Todos" }, ...(meta?.users ?? []).map((u) => ({ value: u.id, label: u.nome }))]} />
            )}
            <FilterSelect value={tagId} onChange={(v) => { setTagId(v); setPage(0); }} placeholder="Tag" options={[{ value: "all", label: "Todas" }, ...(meta?.tags ?? []).map((t) => ({ value: String(t.id), label: t.nome }))]} />
            <Input type="date" className="h-9 w-[140px] bg-background/40" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} />
            <Input type="date" className="h-9 w-[140px] bg-background/40" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} />
          </div>

          {(activeChips.length > 0 || search) && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t" style={{ borderColor: "#2A2D3A" }}>
              {search && (
                <Chip label={`🔍 "${search}"`} onClear={() => { setSearch(""); setPage(0); }} />
              )}
              {activeChips.map((c) => (
                <Chip key={c.key} label={c.label} onClear={c.onClear} />
              ))}
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={clearAll}>
                Limpar filtros
              </Button>
            </div>
          )}
        </div>

        {view === "kanban" ? (
          <KanbanView searchFilter={search} />
        ) : (
          <>
            {/* Table */}
            <div
              className="rounded-xl border overflow-hidden"
              style={{ backgroundColor: "#1A1D27", borderColor: "#2A2D3A" }}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: "#2A2D3A" }}>
                    <Th>Nome</Th>
                    <Th>Telefone</Th>
                    <Th className="hidden md:table-cell">Empreendimento</Th>
                    <Th>Responsável</Th>
                    <Th>Estágio</Th>
                    <Th className="hidden lg:table-cell">Tags</Th>
                    <Th className="hidden lg:table-cell">Criado</Th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b" style={{ borderColor: "#2A2D3A" }}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-4"><Skeleton className="h-5 w-full max-w-[160px]" /></td>
                      ))}
                    </tr>
                  ))}
                  {!isLoading && !data?.rows.length && (
                    <tr>
                      <td colSpan={7} className="px-4 py-16">
                        <div className="flex flex-col items-center text-center gap-4">
                          <div className="h-16 w-16 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(249,115,22,0.1)" }}>
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
                    return (
                      <tr
                        key={l.id}
                        className="border-b transition-colors hover:bg-white/[0.03]"
                        style={{ borderColor: "#2A2D3A" }}
                      >
                        <td className="px-4 py-4">
                          <Link to="/leads/$id" params={{ id: String(l.id) }} className="flex items-center gap-3 group">
                            <Avatar className="h-9 w-9 shrink-0">
                              <AvatarFallback className="text-[11px] font-semibold text-white" style={{ backgroundColor: colorFromString(l.nome) }}>
                                {getInitials(l.nome)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">{l.nome ?? "—"}</div>
                              {l.email && <div className="text-xs text-muted-foreground truncate">{l.email}</div>}
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">{l.numero ?? "—"}</td>
                        <td className="px-4 py-4 hidden md:table-cell text-muted-foreground">
                          {l.id_empreendimento ? empMap.get(l.id_empreendimento) ?? "—" : "—"}
                        </td>
                        <td className="px-4 py-4">
                          {responsavel ? (
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6 shrink-0">
                                <AvatarFallback className="text-[9px] font-semibold text-white" style={{ backgroundColor: colorFromString(responsavel) }}>
                                  {getInitials(responsavel)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-sm text-foreground truncate">{responsavel}</span>
                            </div>
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
                          <div className="flex flex-wrap gap-1">
                            {l.tagIds.map((tid) => {
                              const t = tagMap.get(tid);
                              if (!t) return null;
                              const c = t.cor ?? "#f97316";
                              return (
                                <span
                                  key={tid}
                                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                  style={{ backgroundColor: `${c}26`, color: c }}
                                >
                                  {t.nome}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-4 hidden lg:table-cell">
                          {l.created_at ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-xs text-muted-foreground cursor-default">{relativeTime(l.created_at)}</span>
                              </TooltipTrigger>
                              <TooltipContent>{new Date(l.created_at).toLocaleString("pt-BR")}</TooltipContent>
                            </Tooltip>
                          ) : "—"}
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
      </div>
    </TooltipProvider>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-3 text-left text-[11px] uppercase tracking-wider font-semibold text-muted-foreground ${className ?? ""}`}>
      {children}
    </th>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full text-xs font-medium border"
      style={{ backgroundColor: "rgba(249,115,22,0.1)", borderColor: "rgba(249,115,22,0.3)", color: "#fb923c" }}
    >
      {label}
      <button
        onClick={onClear}
        className="h-4 w-4 inline-flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
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
      <SelectTrigger className="h-9 w-auto min-w-[140px] bg-background/40">
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
