import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, startOfYear } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import {
  Cell,
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
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { calculateJourneyFunnel, createJourneySessionIds } from "@/lib/journey-funnel";
import { cn } from "@/lib/utils";

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

const DONUT_COLORS = ["#C14F21", "#E68F6A", "#F2B9A3", "#A3421C", "#D96D3E", "#7A3115", "#B07D1A", "#2471A3", "#2D7D52", "#52200D"];

function isConvertedStage(name?: string | null) {
  return /fech|ganh|venda|convert/i.test(name ?? "");
}
function isLostStage(name?: string | null) {
  return /perd|lost/i.test(name ?? "");
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function metadataEvent(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const event = (metadata as { event?: unknown }).event;
  return typeof event === "string" ? event : null;
}

function ReportsPage() {
  const { data: me } = useCrmUser();
  const { activeEmpresaId } = useActiveEmpresa();

  const [preset, setPreset] = useState<Preset>("30d");
  const [customFrom, setCustomFrom] = useState<Date | undefined>(subDays(new Date(), 29));
  const [customTo, setCustomTo] = useState<Date | undefined>(new Date());
  const range = useMemo(
    () => presetToRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const { data, isLoading } = useQuery({
    enabled: !!me && !!activeEmpresaId,
    queryKey: ["reports", me?.id, me?.role, activeEmpresaId, range.from.toISOString(), range.to.toISOString()],
    queryFn: async () => {
      const isAgent = me?.role === "agent";
      const empresaIds = activeEmpresaId ? [activeEmpresaId] : [];
      const fromIso = new Date(range.from.setHours(0, 0, 0, 0)).toISOString();
      const toIso = new Date(range.to.setHours(23, 59, 59, 999)).toISOString();

      let lq = supabase
        .from("crm_leads")
        .select("id, lead_id, telefone, lead_quente, id_empresa, nome, crm_stage_id, crm_assigned_to, id_empreendimento, status, created_at, updated_at")
        .in("id_empresa", empresaIds)
        .gte("created_at", fromIso)
        .lte("created_at", toIso);
      if (isAgent && me) lq = lq.eq("crm_assigned_to", me.id);

      const [{ data: leads, error: leadsError }, { data: stages, error: stagesError }, { data: emps, error: empsError }] =
        await Promise.all([
          lq,
          supabase.from("crm_stages").select("id, nome, cor, ordem").eq("id_empresa", activeEmpresaId!).eq("ativo", true).order("ordem"),
          supabase.from("empreendimento").select("id, nome").in("id_empresa", empresaIds),
        ]);
      if (leadsError) throw leadsError;
      if (stagesError) throw stagesError;
      if (empsError) throw empsError;

      const cohort = leads ?? [];
      const crmLeadIds = cohort.map((lead) => lead.id);
      const cohortLegacyLeadIds = cohort.flatMap((lead) => (lead.lead_id === null ? [] : [lead.lead_id]));
      const legacyLeadsResult = await supabase
        .from("lead")
        .select("id,numero,qtd_interacoes,qualificado,status_history")
        .eq("id_empresa", activeEmpresaId!)
        .limit(1000);
      if (legacyLeadsResult.error) throw legacyLeadsResult.error;

      const legacyLeadIds = (legacyLeadsResult.data ?? []).map((lead) => lead.id);

      const classificationsResult = legacyLeadIds.length
        ? await supabase
          .from("crm_conversation_classifications")
            .select("lead_id,cliente_respondeu,qualificado")
            .eq("id_empresa", activeEmpresaId!)
            .in("lead_id", legacyLeadIds)
        : { data: [], error: null };
      if (classificationsResult.error) {
        const code = (classificationsResult.error as { code?: string }).code;
        const message = classificationsResult.error.message ?? "";
        if (code !== "42P01" && code !== "PGRST205" && !message.includes("crm_conversation_classifications")) {
          throw classificationsResult.error;
        }
      }

      const legacyLeadById = new Map(
        (legacyLeadsResult.data ?? []).map((lead) => [lead.id, lead]),
      );
      const legacyLeadBySessionId = new Map<string, NonNullable<typeof legacyLeadsResult.data>[number]>();
      for (const legacyLead of legacyLeadsResult.data ?? []) {
        for (const sessionId of createJourneySessionIds(legacyLead.numero, activeEmpresaId!)) {
          legacyLeadBySessionId.set(sessionId, legacyLead);
        }
      }
      const classifiedResponseLeadIds = new Set(
        (classificationsResult.data ?? [])
          .filter((classification) => classification.cliente_respondeu)
          .map((classification) => classification.lead_id),
      );
      const classifiedQualifiedLeadIds = new Set(
        (classificationsResult.data ?? [])
          .filter((classification) => classification.qualificado)
          .map((classification) => classification.lead_id),
      );
      const journeyLeads = cohort.map((lead) => {
        const legacyLead =
          (lead.lead_id === null ? null : legacyLeadById.get(lead.lead_id)) ??
          createJourneySessionIds(lead.telefone, lead.id_empresa)
            .map((sessionId) => legacyLeadBySessionId.get(sessionId))
            .find(Boolean) ??
          null;
        const history = legacyLead?.status_history?.toLowerCase() ?? "";

        return {
          id: lead.id,
          leadId: lead.lead_id,
          telefones: [legacyLead?.numero, lead.telefone],
          idEmpresa: lead.id_empresa,
          leadQuente: lead.lead_quente,
        legacyEngaged:
          Boolean(legacyLead && classifiedResponseLeadIds.has(legacyLead.id)) ||
          (legacyLead?.qtd_interacoes ?? 0) >= 2,
        legacyQualified:
          Boolean(legacyLead && classifiedQualifiedLeadIds.has(legacyLead.id)) ||
            legacyLead?.qualificado === 1 ||
            (history.includes("qualificado") && !history.includes("desqualificado")),
        };
      });
      const sessionIds = [
        ...new Set(
          journeyLeads.flatMap((lead) =>
            lead.telefones.flatMap((telefone) => createJourneySessionIds(telefone, lead.idEmpresa)),
          ),
        ),
      ];

      const [messageResults, activitiesResult, appointmentsResult] = await Promise.all([
        Promise.all(
          chunk(sessionIds, 80).map((group) =>
            supabase.from("n8n_chat_conversas").select("numero,type").in("numero", group),
          ),
        ),
        crmLeadIds.length
          ? supabase.from("crm_lead_activities").select("lead_id,metadata,descricao").in("lead_id", crmLeadIds)
          : Promise.resolve({ data: [], error: null }),
        cohortLegacyLeadIds.length
          ? supabase
              .from("agendamento")
              .select("id_lead")
              .eq("id_empresa", activeEmpresaId!)
              .is("deleted_at", null)
              .in("id_lead", cohortLegacyLeadIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      for (const result of messageResults) if (result.error) throw result.error;
      if (activitiesResult.error) throw activitiesResult.error;
      if (appointmentsResult.error) throw appointmentsResult.error;

      const journey = calculateJourneyFunnel({
        leads: journeyLeads,
        messages: messageResults.flatMap((result) =>
          (result.data ?? []).flatMap((message) =>
            message.numero ? [{ sessionId: message.numero, type: message.type }] : [],
          ),
        ),
        activities: (activitiesResult.data ?? []).map((activity) => ({
          leadId: activity.lead_id,
          event: metadataEvent(activity.metadata),
          descricao: activity.descricao,
        })),
        appointments: (appointmentsResult.data ?? []).flatMap((appointment) =>
          appointment.id_lead === null ? [] : [{ legacyLeadId: appointment.id_lead }],
        ),
      });

      return {
        leads: cohort,
        stages: stages ?? [],
        emps: emps ?? [],
        journey,
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
          <JourneyFunnelPanel counts={data.journey} />
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
    lead_id: number | null;
    telefone: string;
    lead_quente: boolean | null;
    id_empresa: number;
    nome: string;
    crm_stage_id: number | null;
    crm_assigned_to: string | null;
    id_empreendimento: number | null;
    status: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>;
  stages: Array<{ id: number; nome: string; cor: string | null; ordem: number }>;
  emps: Array<{ id: number; nome: string }>;
  journey: {
    received: number;
    engaged: number;
    hot: number;
    sentToCrm: number;
    scheduled: number;
  };
};

function JourneyFunnelPanel({ counts }: { counts: ReportData["journey"] }) {
  const rows = [
    { label: "Leads recebidos", value: counts.received, color: "bg-[#C14F21]" },
    { label: "Engajaram com a IA", value: counts.engaged, color: "bg-[#C14F21]" },
    { label: "Leads quentes", value: counts.hot, color: "bg-[#C14F21]" },
    { label: "Enviados ao corretor / CRM", value: counts.sentToCrm, color: "bg-[#2D7D52]" },
    { label: "Visitas agendadas", value: counts.scheduled, color: "bg-[#2D7D52]" },
  ];
  const percentage = (value: number) => (counts.received ? (value / counts.received) * 100 : 0);

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-4">
        <CardTitle>Funil da jornada</CardTitle>
        <p className="text-sm text-muted-foreground">Consolidado do período</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row) => {
          const pct = percentage(row.value);
          return (
            <div key={row.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm font-medium">
                <span>{row.label}</span>
                <span className="text-muted-foreground">{row.value} · {pct.toFixed(1)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full transition-all", row.color)} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        <p className="pt-1 text-xs text-muted-foreground">
          Eventos posteriores são considerados para os leads recebidos neste período.
        </p>
      </CardContent>
    </Card>
  );
}

/* Relatórios removidos: canal e tempo de fechamento.

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
                            ? "bg-[var(--success-bg)] text-[var(--success)] hover:bg-[var(--success-bg)] border border-[var(--success)]/30"
                            : r.taxa >= 10
                              ? "bg-[var(--warning-bg)] text-[var(--warning)] hover:bg-[var(--warning-bg)] border border-[var(--warning)]/30"
                              : "bg-[var(--danger-bg)] text-[var(--danger)] hover:bg-[var(--danger-bg)] border border-[var(--danger)]/30",
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
                <Bar dataKey="gerados" name="Gerados" fill="var(--info)" radius={[0, 6, 6, 0]} />
                <Bar dataKey="convertidos" name="Convertidos" fill="var(--success)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Panel 3: Closing Time

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
              <Line type="monotone" dataKey="dias" stroke="var(--chart-primary)" strokeWidth={2} dot={{ r: 3 }} />
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
*/


/* -------------------- Panel 5: Empreendimentos -------------------- */

function EmpreendimentoPanel({ data }: { data: ReportData }) {
  const stageById = new Map(data.stages.map((s) => [s.id, s]));
  const empMap = new Map(data.emps.map((e) => [e.id, e.nome]));
  type Row = { id: number; nome: string; total: number; andamento: number; convertidos: number; perdidos: number };
  const map = new Map<number, Row>();
  for (const l of data.leads) {
    const id = l.id_empreendimento ?? 0;
    const nome = id ? empMap.get(id) ?? "—" : "Sem interesse";
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
                    formatter={(value, entry) => {
                      const v = (entry?.payload as { value?: number } | undefined)?.value ?? 0;
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
                      <td className="py-2 text-right text-[var(--success)]">{r.convertidos}</td>
                      <td className="py-2 text-right text-[var(--danger)]">{r.perdidos}</td>
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
