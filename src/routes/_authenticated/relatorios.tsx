import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, startOfYear, startOfWeek, addWeeks, isAfter } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarIcon,
  ChevronDown,
  ChevronRight,
  Table as TableIcon,
  BarChart3,
  Trophy,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getInitials, colorFromString } from "@/lib/lead-visuals";

export const Route = createFileRoute("/_authenticated/relatorios")({
  component: ReportsPage,
});

type Range = { from: Date; to: Date };
type Preset = "7d" | "30d" | "90d" | "year" | "custom";

const PRESET_LABEL: Record<Preset, string> = {
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  year: "Este ano",
  custom: "Personalizado",
};

function presetToRange(p: Preset, customFrom?: Date, customTo?: Date): Range {
  const today = new Date();
  if (p === "7d") return { from: subDays(today, 6), to: today };
  if (p === "30d") return { from: subDays(today, 29), to: today };
  if (p === "90d") return { from: subDays(today, 89), to: today };
  if (p === "year") return { from: startOfYear(today), to: today };
  return { from: customFrom ?? subDays(today, 29), to: customTo ?? today };
}

const STAGE_COLORS = ["#3B82F6", "#6366F1", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981"];
const DONUT_COLORS = ["#EC2C5C", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#06B6D4", "#F97316", "#84CC16", "#EF4444", "#6366F1"];

function isConvertedStage(name?: string | null) {
  return /fech|ganh|venda|convert/i.test(name ?? "");
}
function isLostStage(name?: string | null) {
  return /perd|lost/i.test(name ?? "");
}

function daysBetween(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return null;
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
  return d >= 0 ? d : null;
}

function ReportsPage() {
  const { data: me } = useCrmUser();
  const { data: allowed } = useAllowedEmpresas();

  const [preset, setPreset] = useState<Preset>("30d");
  const [customFrom, setCustomFrom] = useState<Date | undefined>(subDays(new Date(), 29));
  const [customTo, setCustomTo] = useState<Date | undefined>(new Date());
  const range = useMemo(
    () => presetToRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const { data, isLoading } = useQuery({
    enabled: !!me && !!allowed,
    queryKey: ["reports", me?.id, me?.role, allowed, range.from.toISOString(), range.to.toISOString()],
    queryFn: async () => {
      const isAgent = me?.role === "agent";
      const empresaIds = allowed ?? [];
      const fromIso = new Date(range.from.setHours(0, 0, 0, 0)).toISOString();
      const toIso = new Date(range.to.setHours(23, 59, 59, 999)).toISOString();

      let lq = supabase
        .from("lead")
        .select("id, nome, crm_stage_id, crm_assigned_to, id_empreendimento, status, created_at, updated_at")
        .in("id_empresa", empresaIds)
        .gte("created_at", fromIso)
        .lte("created_at", toIso);
      if (isAgent && me) lq = lq.eq("crm_assigned_to", me.id);

      const [{ data: leads }, { data: stages }, { data: users }, { data: emps }, { data: lt }, { data: tags }] =
        await Promise.all([
          lq,
          supabase.from("crm_stages").select("id, nome, cor, ordem").eq("ativo", true).order("ordem"),
          supabase.from("crm_users").select("id, nome, email").in("id_empresa", empresaIds),
          supabase.from("empreendimento").select("id, nome").in("id_empresa", empresaIds),
          supabase.from("crm_lead_tags").select("lead_id, tag_id"),
          supabase.from("crm_tags").select("id, nome").in("id_empresa", empresaIds),
        ]);

      return {
        leads: leads ?? [],
        stages: stages ?? [],
        users: users ?? [],
        emps: emps ?? [],
        leadTags: lt ?? [],
        tags: tags ?? [],
      };
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-foreground">Relatórios &amp; Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {format(range.from, "dd MMM", { locale: ptBR })} – {format(range.to, "dd MMM yyyy", { locale: ptBR })}
          </p>
        </div>
        <PeriodFilter
          preset={preset}
          setPreset={setPreset}
          customFrom={customFrom}
          customTo={customTo}
          setCustomFrom={setCustomFrom}
          setCustomTo={setCustomTo}
        />
      </div>

      {isLoading || !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="rounded-2xl h-72 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <FunnelPanel data={data} />
          <ChannelPanel data={data} />
          <ClosingTimePanel data={data} range={range} />
          <BrokerPanel data={data} />
          <div className="lg:col-span-2">
            <EmpreendimentoPanel data={data} />
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------- Period Filter -------------------- */

function PeriodFilter({
  preset,
  setPreset,
  customFrom,
  customTo,
  setCustomFrom,
  setCustomTo,
}: {
  preset: Preset;
  setPreset: (p: Preset) => void;
  customFrom?: Date;
  customTo?: Date;
  setCustomFrom: (d?: Date) => void;
  setCustomTo: (d?: Date) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
        <SelectTrigger className="h-9 w-[200px]">
          <SelectValue>{PRESET_LABEL[preset]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
            <SelectItem key={p} value={p}>
              {PRESET_LABEL[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {preset === "custom" && (
        <>
          <DatePick value={customFrom} onChange={setCustomFrom} placeholder="De" />
          <DatePick value={customTo} onChange={setCustomTo} placeholder="Até" />
        </>
      )}
    </div>
  );
}

function DatePick({ value, onChange, placeholder }: { value?: Date; onChange: (d?: Date) => void; placeholder: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-9 w-[150px] justify-start text-left font-normal", !value && "text-muted-foreground")}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? format(value, "dd/MM/yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar mode="single" selected={value} onSelect={onChange} initialFocus className="pointer-events-auto" />
      </PopoverContent>
    </Popover>
  );
}

/* -------------------- Panel 1: Funnel -------------------- */

type ReportData = {
  leads: Array<{
    id: number;
    nome: string;
    crm_stage_id: number | null;
    crm_assigned_to: string | null;
    id_empreendimento: number | null;
    status: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>;
  stages: Array<{ id: number; nome: string; cor: string | null; ordem: number }>;
  users: Array<{ id: string; nome: string; email: string }>;
  emps: Array<{ id: number; nome: string }>;
  leadTags: Array<{ lead_id: number; tag_id: number }>;
  tags: Array<{ id: number; nome: string }>;
};

function FunnelPanel({ data }: { data: ReportData }) {
  const orderedStages = [...data.stages].sort((a, b) => a.ordem - b.ordem);
  const counts = orderedStages.map((s) => ({
    stage: s,
    total: data.leads.filter((l) => l.crm_stage_id === s.id).length,
  }));
  const max = Math.max(1, ...counts.map((c) => c.total));

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>Funil de Conversão entre Estágios</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {counts.length === 0 && <p className="text-sm text-muted-foreground">Sem estágios cadastrados.</p>}
        {counts.map((c, i) => {
          const widthPct = 50 + ((c.total / max) * 50);
          const next = counts[i + 1];
          const advance = next ? (c.total ? (next.total / c.total) * 100 : 0) : null;
          const lost = advance != null ? 100 - advance : null;
          const color = STAGE_COLORS[Math.min(i, STAGE_COLORS.length - 1)];
          const isLast = i === counts.length - 1;
          const fill = isLast ? "#10B981" : color;
          return (
            <div key={c.stage.id} className="flex flex-col items-center">
              <div
                title={`${c.stage.nome} · ${c.total} leads${advance != null ? ` · ${advance.toFixed(0)}% conversão · ${lost?.toFixed(0)}% perda` : ""}`}
                className="rounded-lg px-4 py-3 text-center transition-all hover:brightness-110"
                style={{
                  width: `${widthPct}%`,
                  background: `linear-gradient(135deg, ${fill}, ${fill}aa)`,
                }}
              >
                <div className="text-sm font-semibold text-white">{c.stage.nome}</div>
                <div className="text-xs text-white/90 mt-0.5">
                  {c.total} leads
                  {advance != null && (
                    <span className="ml-2 opacity-90">
                      · {advance.toFixed(0)}% avançaram · {lost?.toFixed(0)}% perdidos
                    </span>
                  )}
                </div>
              </div>
              {next && (
                <div className="my-1 text-[11px] font-semibold text-muted-foreground">
                  ▼ {advance?.toFixed(0)}%
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* -------------------- Panel 2: Channel -------------------- */

function ChannelPanel({ data }: { data: ReportData }) {
  const [mode, setMode] = useState<"table" | "chart">("table");

  const tagNameById = new Map(data.tags.map((t) => [t.id, t.nome]));
  const tagsByLead = new Map<number, string[]>();
  for (const lt of data.leadTags) {
    const name = tagNameById.get(lt.tag_id);
    if (!name) continue;
    const arr = tagsByLead.get(lt.lead_id) ?? [];
    arr.push(name);
    tagsByLead.set(lt.lead_id, arr);
  }

  const stageById = new Map(data.stages.map((s) => [s.id, s]));
  const channelMap = new Map<string, { gerados: number; convertidos: number; closeTimes: number[] }>();

  for (const l of data.leads) {
    const channels = tagsByLead.get(l.id);
    const names = channels && channels.length ? channels : ["Sem origem"];
    const st = l.crm_stage_id ? stageById.get(l.crm_stage_id) : null;
    const converted = isConvertedStage(st?.nome);
    const dt = converted ? daysBetween(l.created_at, l.updated_at) : null;
    for (const name of names) {
      const cur = channelMap.get(name) ?? { gerados: 0, convertidos: 0, closeTimes: [] };
      cur.gerados += 1;
      if (converted) cur.convertidos += 1;
      if (dt != null) cur.closeTimes.push(dt);
      channelMap.set(name, cur);
    }
  }

  const rows = Array.from(channelMap.entries())
    .map(([nome, v]) => {
      const taxa = v.gerados ? (v.convertidos / v.gerados) * 100 : 0;
      const tempo = v.closeTimes.length ? v.closeTimes.reduce((a, b) => a + b, 0) / v.closeTimes.length : null;
      return { nome, gerados: v.gerados, convertidos: v.convertidos, taxa, tempo };
    })
    .sort((a, b) => b.taxa - a.taxa);

  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Qual canal converte mais?</CardTitle>
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setMode("table")}
            className={cn("px-3 py-1.5 text-xs flex items-center gap-1.5", mode === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <TableIcon className="h-3.5 w-3.5" /> Tabela
          </button>
          <button
            onClick={() => setMode("chart")}
            className={cn("px-3 py-1.5 text-xs flex items-center gap-1.5", mode === "chart" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <BarChart3 className="h-3.5 w-3.5" /> Gráfico
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados no período.</p>
        ) : mode === "table" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 font-medium">Origem</th>
                  <th className="text-right py-2 font-medium">Gerados</th>
                  <th className="text-right py-2 font-medium">Convertidos</th>
                  <th className="text-right py-2 font-medium">Taxa</th>
                  <th className="text-right py-2 font-medium">Tempo médio</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.nome} className="border-b border-border/40">
                    <td className="py-2">{r.nome}</td>
                    <td className="py-2 text-right">{r.gerados}</td>
                    <td className="py-2 text-right">{r.convertidos}</td>
                    <td className="py-2 text-right">
                      <Badge
                        className={cn(
                          "font-medium",
                          r.taxa >= 30
                            ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20"
                            : r.taxa >= 10
                              ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/20"
                              : "bg-rose-500/20 text-rose-300 hover:bg-rose-500/20",
                        )}
                      >
                        {r.taxa.toFixed(1)}%
                      </Badge>
                    </td>
                    <td className="py-2 text-right text-muted-foreground">
                      {r.tempo != null ? `${r.tempo.toFixed(1)} d` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis type="number" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis type="category" dataKey="nome" stroke="var(--color-muted-foreground)" fontSize={12} width={110} />
                <RTooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="gerados" name="Gerados" fill="#3B82F6" radius={[0, 6, 6, 0]} />
                <Bar dataKey="convertidos" name="Convertidos" fill="#10B981" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------- Panel 3: Closing Time -------------------- */

function ClosingTimePanel({ data, range }: { data: ReportData; range: Range }) {
  const stageById = new Map(data.stages.map((s) => [s.id, s]));
  const closed = data.leads
    .map((l) => {
      const st = l.crm_stage_id ? stageById.get(l.crm_stage_id) : null;
      if (!isConvertedStage(st?.nome)) return null;
      const d = daysBetween(l.created_at, l.updated_at);
      if (d == null) return null;
      return { dias: d, when: new Date(l.updated_at as string) };
    })
    .filter(Boolean) as Array<{ dias: number; when: Date }>;

  const avg = closed.length ? closed.reduce((a, b) => a + b.dias, 0) / closed.length : 0;
  const min = closed.length ? Math.min(...closed.map((c) => c.dias)) : 0;
  const max = closed.length ? Math.max(...closed.map((c) => c.dias)) : 0;

  // Weekly buckets
  const weeks: Array<{ label: string; start: Date; total: number; sum: number; count: number }> = [];
  let cursor = startOfWeek(range.from, { weekStartsOn: 1 });
  while (!isAfter(cursor, range.to)) {
    weeks.push({ label: format(cursor, "dd/MM", { locale: ptBR }), start: new Date(cursor), total: 0, sum: 0, count: 0 });
    cursor = addWeeks(cursor, 1);
  }
  for (const c of closed) {
    const idx = weeks.findIndex((w, i) => c.when >= w.start && (i === weeks.length - 1 || c.when < weeks[i + 1].start));
    if (idx >= 0) {
      weeks[idx].sum += c.dias;
      weeks[idx].count += 1;
    }
  }
  const lineData = weeks.map((w) => ({
    semana: w.label,
    dias: w.count ? +(w.sum / w.count).toFixed(1) : 0,
    conv: w.count,
  }));

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>Tempo Médio de Fechamento</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <KpiMini label="Tempo médio" value={`${avg.toFixed(1)} d`} />
          <KpiMini label="Mais rápido" value={`${min.toFixed(1)} d`} />
          <KpiMini label="Mais lento" value={`${max.toFixed(1)} d`} />
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="semana" stroke="var(--color-muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={12} />
              <RTooltip
                contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 12 }}
                formatter={(val: number, _name, p) => [`${val} dias — ${p.payload.conv} conversões`, "Média"]}
                labelFormatter={(l) => `Semana de ${l}`}
              />
              <Line type="monotone" dataKey="dias" stroke="#EC2C5C" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function KpiMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

/* -------------------- Panel 4: Brokers -------------------- */

function BrokerPanel({ data }: { data: ReportData }) {
  const stageById = new Map(data.stages.map((s) => [s.id, s]));
  const [expanded, setExpanded] = useState<string | null>(null);

  const byBroker = new Map<string, { atribuidos: number; convertidos: number; ativos: number; closeTimes: number[]; weekly: number[]; convertedLeads: Array<{ id: number; nome: string }>; stageDist: Map<number, number> }>();
  // 8-week sparkline buckets ending today
  const now = new Date();
  const weekStart = (d: Date) => startOfWeek(d, { weekStartsOn: 1 });
  const buckets: Date[] = [];
  for (let i = 7; i >= 0; i--) buckets.push(weekStart(subDays(now, i * 7)));

  for (const l of data.leads) {
    const k = l.crm_assigned_to ?? "—";
    const st = l.crm_stage_id ? stageById.get(l.crm_stage_id) : null;
    const converted = isConvertedStage(st?.nome);
    const lost = isLostStage(st?.nome);
    const cur = byBroker.get(k) ?? { atribuidos: 0, convertidos: 0, ativos: 0, closeTimes: [], weekly: new Array(8).fill(0), convertedLeads: [], stageDist: new Map() };
    cur.atribuidos += 1;
    if (converted) {
      cur.convertidos += 1;
      cur.convertedLeads.push({ id: l.id, nome: l.nome });
      const dt = daysBetween(l.created_at, l.updated_at);
      if (dt != null) cur.closeTimes.push(dt);
    }
    if (!converted && !lost) {
      cur.ativos += 1;
      if (l.crm_stage_id != null) cur.stageDist.set(l.crm_stage_id, (cur.stageDist.get(l.crm_stage_id) ?? 0) + 1);
    }
    if (l.created_at) {
      const w = weekStart(new Date(l.created_at));
      const idx = buckets.findIndex((b) => b.getTime() === w.getTime());
      if (idx >= 0) cur.weekly[idx] += 1;
    }
    byBroker.set(k, cur);
  }

  const userMap = new Map(data.users.map((u) => [u.id, u]));
  const rows = Array.from(byBroker.entries())
    .map(([id, v]) => {
      const u = userMap.get(id);
      const tempo = v.closeTimes.length ? v.closeTimes.reduce((a, b) => a + b, 0) / v.closeTimes.length : null;
      return {
        id,
        nome: u?.nome ?? "Sem responsável",
        taxa: v.atribuidos ? (v.convertidos / v.atribuidos) * 100 : 0,
        tempo,
        ...v,
      };
    })
    .sort((a, b) => b.convertidos - a.convertidos || b.taxa - a.taxa);

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>Performance por Corretor</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 font-medium w-10">#</th>
                  <th className="text-left py-2 font-medium">Corretor</th>
                  <th className="text-right py-2 font-medium">Leads</th>
                  <th className="text-right py-2 font-medium">Conv.</th>
                  <th className="text-right py-2 font-medium">Taxa</th>
                  <th className="text-right py-2 font-medium">T. médio</th>
                  <th className="text-right py-2 font-medium">Ativos</th>
                  <th className="text-right py-2 font-medium">8 sem.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const open = expanded === r.id;
                  return (
                    <>
                      <tr
                        key={r.id}
                        onClick={() => setExpanded(open ? null : r.id)}
                        className={cn("border-b border-border/40 cursor-pointer hover:bg-white/[0.02]", open && "bg-white/[0.03]")}
                      >
                        <td className="py-2">
                          <span className="inline-flex items-center gap-1">
                            {medals[i] ? <span>{medals[i]}</span> : <span className="text-muted-foreground">{i + 1}</span>}
                          </span>
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-7 w-7">
                              <AvatarFallback
                                className="text-[10px] font-semibold text-white"
                                style={{ backgroundColor: colorFromString(r.nome) }}
                              >
                                {getInitials(r.nome, "?")}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate">{r.nome}</span>
                            {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          </div>
                        </td>
                        <td className="py-2 text-right">{r.atribuidos}</td>
                        <td className="py-2 text-right">{r.convertidos}</td>
                        <td className="py-2 text-right">
                          <span className={cn(r.taxa >= 30 ? "text-emerald-400" : r.taxa >= 10 ? "text-amber-400" : "text-rose-400")}>
                            {r.taxa.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-2 text-right text-muted-foreground">{r.tempo != null ? `${r.tempo.toFixed(1)} d` : "—"}</td>
                        <td className="py-2 text-right">{r.ativos}</td>
                        <td className="py-2 pl-2 w-[90px]">
                          <Sparkline values={r.weekly} />
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-border/40 bg-black/20">
                          <td colSpan={8} className="p-4">
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Convertidos no período</div>
                                {r.convertedLeads.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">Nenhum.</p>
                                ) : (
                                  <ul className="space-y-1 max-h-40 overflow-y-auto text-xs">
                                    {r.convertedLeads.map((cl) => (
                                      <li key={cl.id} className="flex items-center justify-between">
                                        <span>{cl.nome}</span>
                                        <span className="text-muted-foreground">#{cl.id}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div>
                                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Ativos por estágio</div>
                                <StageStack stages={data.stages} dist={r.stageDist} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 80;
  const h = 24;
  const step = w / Math.max(1, values.length - 1);
  const points = values.map((v, i) => `${i * step},${h - (v / max) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline fill="none" stroke="#EC2C5C" strokeWidth={1.5} points={points} />
    </svg>
  );
}

function StageStack({ stages, dist }: { stages: ReportData["stages"]; dist: Map<number, number> }) {
  const total = Array.from(dist.values()).reduce((a, b) => a + b, 0);
  if (!total) return <p className="text-xs text-muted-foreground">Nenhum ativo.</p>;
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-border/30">
        {stages.map((s, i) => {
          const v = dist.get(s.id) ?? 0;
          if (!v) return null;
          return (
            <div
              key={s.id}
              style={{ width: `${(v / total) * 100}%`, background: s.cor ?? STAGE_COLORS[i % STAGE_COLORS.length] }}
              title={`${s.nome}: ${v}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {stages.map((s, i) => {
          const v = dist.get(s.id) ?? 0;
          if (!v) return null;
          return (
            <span key={s.id} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: s.cor ?? STAGE_COLORS[i % STAGE_COLORS.length] }} />
              {s.nome} ({v})
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------- Panel 5: Empreendimentos -------------------- */

function EmpreendimentoPanel({ data }: { data: ReportData }) {
  const stageById = new Map(data.stages.map((s) => [s.id, s]));
  const empMap = new Map(data.emps.map((e) => [e.id, e.nome]));
  type Row = { id: number; nome: string; total: number; andamento: number; convertidos: number; perdidos: number };
  const map = new Map<number, Row>();
  for (const l of data.leads) {
    const id = l.id_empreendimento ?? 0;
    const nome = empMap.get(id) ?? "—";
    const st = l.crm_stage_id ? stageById.get(l.crm_stage_id) : null;
    const cur = map.get(id) ?? { id, nome, total: 0, andamento: 0, convertidos: 0, perdidos: 0 };
    cur.total += 1;
    if (isConvertedStage(st?.nome)) cur.convertidos += 1;
    else if (isLostStage(st?.nome)) cur.perdidos += 1;
    else cur.andamento += 1;
    map.set(id, cur);
  }
  const rows = Array.from(map.values());
  const grandTotal = rows.reduce((a, b) => a + b.total, 0);

  const [sortKey, setSortKey] = useState<keyof Row | "taxa">("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const sorted = [...rows].sort((a, b) => {
    const av = sortKey === "taxa" ? (a.total ? a.convertidos / a.total : 0) : (a[sortKey] as number | string);
    const bv = sortKey === "taxa" ? (b.total ? b.convertidos / b.total : 0) : (b[sortKey] as number | string);
    if (typeof av === "string" && typeof bv === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      andamento: acc.andamento + r.andamento,
      convertidos: acc.convertidos + r.convertidos,
      perdidos: acc.perdidos + r.perdidos,
    }),
    { total: 0, andamento: 0, convertidos: 0, perdidos: 0 },
  );
  const totalTaxa = totals.total ? (totals.convertidos / totals.total) * 100 : 0;

  const donut = rows
    .filter((r) => r.total > 0)
    .map((r, i) => ({ name: r.nome, value: r.total, color: DONUT_COLORS[i % DONUT_COLORS.length], convertidos: r.convertidos, taxa: r.total ? (r.convertidos / r.total) * 100 : 0 }));

  const headerBtn = (key: keyof Row | "taxa", label: string, align: "left" | "right" = "right") => (
    <th
      onClick={() => {
        if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
        else { setSortKey(key); setSortDir("desc"); }
      }}
      className={cn("py-2 font-medium cursor-pointer select-none hover:text-foreground", align === "left" ? "text-left" : "text-right")}
    >
      {label} {sortKey === key && (sortDir === "asc" ? "↑" : "↓")}
    </th>
  );

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>Leads por Empreendimento</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="h-72">
            {donut.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donut} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {donut.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <RTooltip
                    contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 12 }}
                    formatter={(_v, _n, p) => {
                      const d = p.payload as { name: string; value: number; convertidos: number; taxa: number };
                      return [`${d.value} leads · ${d.convertidos} conv · ${d.taxa.toFixed(1)}%`, d.name];
                    }}
                  />
                  <Legend
                    layout="vertical"
                    align="right"
                    verticalAlign="middle"
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value, entry: { payload?: { value: number } }) => {
                      const v = entry?.payload?.value ?? 0;
                      const pct = grandTotal ? ((v / grandTotal) * 100).toFixed(0) : "0";
                      return `${value} — ${v} (${pct}%)`;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  {headerBtn("nome", "Empreendimento", "left")}
                  {headerBtn("total", "Total")}
                  {headerBtn("andamento", "Em and.")}
                  {headerBtn("convertidos", "Conv.")}
                  {headerBtn("perdidos", "Perd.")}
                  {headerBtn("taxa", "Taxa")}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const taxa = r.total ? (r.convertidos / r.total) * 100 : 0;
                  return (
                    <tr key={r.id} className="border-b border-border/40">
                      <td className="py-2">{r.nome}</td>
                      <td className="py-2 text-right">{r.total}</td>
                      <td className="py-2 text-right text-muted-foreground">{r.andamento}</td>
                      <td className="py-2 text-right text-emerald-400">{r.convertidos}</td>
                      <td className="py-2 text-right text-rose-400">{r.perdidos}</td>
                      <td className="py-2 text-right">{taxa.toFixed(1)}%</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-border font-semibold bg-white/[0.02]">
                  <td className="py-2">Total</td>
                  <td className="py-2 text-right">{totals.total}</td>
                  <td className="py-2 text-right">{totals.andamento}</td>
                  <td className="py-2 text-right">{totals.convertidos}</td>
                  <td className="py-2 text-right">{totals.perdidos}</td>
                  <td className="py-2 text-right">{totalTaxa.toFixed(1)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}