import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { useCrmUser } from "@/hooks/use-crm-user";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { calculateJourneyFunnel, createJourneySessionIds, type JourneyFunnelCounts } from "@/lib/journey-funnel";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/analise-conversas")({
  component: ConversationAnalysisPage,
});

type EmpreendimentoRow = Pick<Database["public"]["Tables"]["empreendimento"]["Row"], "id" | "nome" | "id_empresa">;
type LeadRow = Pick<
  Database["public"]["Tables"]["lead"]["Row"],
  | "id"
  | "numero"
  | "qtd_interacoes"
  | "qualificado"
  | "status_history"
  | "ativacao"
>;
type CrmLeadRow = Pick<
  Database["public"]["Tables"]["crm_leads"]["Row"],
  "id" | "lead_id" | "telefone" | "lead_quente" | "id_empresa" | "id_empreendimento" | "created_at"
>;
type ChatRow = Pick<Database["public"]["Tables"]["n8n_chat_conversas"]["Row"], "numero" | "type">;
const ALL = "all";
const TYPE_ALL = "all";
const TYPE_INBOUND = "inbound";
const TYPE_ACTIVATION = "activation";
const emptyJourneyCounts: JourneyFunnelCounts = {
  received: 0,
  engaged: 0,
  hot: 0,
  sentToCrm: 0,
  scheduled: 0,
};

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return dateKey(date);
}

function defaultEndDate() {
  return dateKey(new Date());
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function percentage(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function fetchMessages(sessionIds: string[]) {
  if (!sessionIds.length) return [];
  const rows: ChatRow[] = [];
  for (const group of chunk([...new Set(sessionIds)], 80)) {
    const { data, error } = await supabase
      .from("n8n_chat_conversas")
      .select("numero,type")
      .in("numero", group)
      .order("time", { ascending: true });
    if (error) throw error;
    rows.push(...((data ?? []) as ChatRow[]));
  }
  return rows;
}

function metadataEvent(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const event = (metadata as { event?: unknown }).event;
  return typeof event === "string" ? event : null;
}

function ConversationAnalysisPage() {
  const { data: me } = useCrmUser();
  const { activeEmpresaId: companyId, activeEmpresa, isSuperAdmin } = useActiveEmpresa();
  const canView = me?.role === "manager" || me?.role === "super_admin";
  const [empreendimentoId, setEmpreendimentoId] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<string>(TYPE_ALL);
  const [dateFrom, setDateFrom] = useState(defaultStartDate);
  const [dateTo, setDateTo] = useState(defaultEndDate);

  useEffect(() => { setEmpreendimentoId(ALL); }, [companyId]);

  const empreendimentosQuery = useQuery({
    enabled: !!companyId && canView,
    queryKey: ["analysis-empreendimentos", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empreendimento")
        .select("id,nome,id_empresa")
        .eq("id_empresa", companyId)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as EmpreendimentoRow[];
    },
  });

  const empreendimentos = empreendimentosQuery.data ?? [];
  const analysisQuery = useQuery({
    enabled: !!companyId && canView,
    queryKey: ["conversation-analysis", companyId, empreendimentoId, typeFilter, dateFrom, dateTo],
    queryFn: async () => {
      if (!companyId) return emptyJourneyCounts;

      let crmLeadQuery = supabase
        .from("crm_leads")
        .select("id,lead_id,telefone,lead_quente,id_empresa,id_empreendimento,created_at")
        .eq("id_empresa", companyId)
        .gte("created_at", `${dateFrom}T00:00:00`)
        .lte("created_at", `${dateTo}T23:59:59.999`);
      if (empreendimentoId !== ALL) crmLeadQuery = crmLeadQuery.eq("id_empreendimento", Number(empreendimentoId));

      const { data: crmLeadRows, error: crmLeadError } = await crmLeadQuery;
      if (crmLeadError) throw crmLeadError;

      const cohort = (crmLeadRows ?? []) as CrmLeadRow[];
      const legacyLeadsResult = await supabase
        .from("lead")
        .select("id,numero,qtd_interacoes,qualificado,status_history,ativacao")
        .eq("id_empresa", companyId)
        .limit(1000);
      if (legacyLeadsResult.error) throw legacyLeadsResult.error;

      const legacyLeads = (legacyLeadsResult.data ?? []) as LeadRow[];
      const legacyLeadById = new Map(legacyLeads.map((lead) => [lead.id, lead]));
      const legacyLeadBySessionId = new Map<string, LeadRow>();
      for (const legacyLead of legacyLeads) {
        for (const sessionId of createJourneySessionIds(legacyLead.numero, companyId)) {
          legacyLeadBySessionId.set(sessionId, legacyLead);
        }
      }

      const classificationsResult = legacyLeads.length
        ? await supabase
            .from("crm_conversation_classifications")
            .select("lead_id,cliente_respondeu,qualificado")
            .eq("id_empresa", companyId)
            .in("lead_id", legacyLeads.map((lead) => lead.id))
        : { data: [], error: null };
      if (classificationsResult.error) {
        const code = (classificationsResult.error as { code?: string }).code;
        const message = classificationsResult.error.message ?? "";
        if (code !== "42P01" && code !== "PGRST205" && !message.includes("crm_conversation_classifications")) {
          throw classificationsResult.error;
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
      const mappedLeads = cohort.map((lead) => {
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
          ativacao: legacyLead?.ativacao,
        };
      });
      const journeyLeads = mappedLeads.filter((lead) =>
        typeFilter === TYPE_ALL ||
        (typeFilter === TYPE_INBOUND ? lead.ativacao === false : lead.ativacao === true),
      );
      const sessionIds = [
        ...new Set(
          journeyLeads.flatMap((lead) =>
            lead.telefones.flatMap((telefone) => createJourneySessionIds(telefone, lead.idEmpresa)),
          ),
        ),
      ];
      const crmLeadIds = journeyLeads.map((lead) => lead.id);
      const legacyLeadIds = journeyLeads.flatMap((lead) => lead.leadId === null ? [] : [lead.leadId]);
      const [messages, activitiesResult, appointmentsResult] = await Promise.all([
        fetchMessages(sessionIds),
        crmLeadIds.length
          ? supabase.from("crm_lead_activities").select("lead_id,metadata,descricao").in("lead_id", crmLeadIds)
          : Promise.resolve({ data: [], error: null }),
        legacyLeadIds.length
          ? supabase
              .from("agendamento")
              .select("id_lead")
              .eq("id_empresa", companyId)
              .is("deleted_at", null)
              .in("id_lead", legacyLeadIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (activitiesResult.error) throw activitiesResult.error;
      if (appointmentsResult.error) throw appointmentsResult.error;

      return calculateJourneyFunnel({
        leads: journeyLeads,
        messages: messages.flatMap((message) =>
          message.numero ? [{ sessionId: message.numero, type: message.type }] : [],
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
    },
  });

  const totals = analysisQuery.data ?? emptyJourneyCounts;

  const selectedCompanyName = activeEmpresa?.nome ?? "empresa";
  const selectedEmpreendimentoName =
    empreendimentoId === ALL
      ? "todos os empreendimentos"
      : empreendimentos.find((item) => String(item.id) === empreendimentoId)?.nome ?? "empreendimento";

  if (me && !canView) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-xl border bg-card p-8 text-center text-muted-foreground">
        Esta área está disponível para gestores e super administradores.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Análise de Funil</h1>
          <p className="text-sm text-muted-foreground">
            Análise de leads de {selectedEmpreendimentoName} em {selectedCompanyName}.
          </p>
        </div>
      </div>

      <Card className="rounded-xl">
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {isSuperAdmin && <LabeledSelect label="Empresa"><div className="h-10 rounded-md border bg-muted/30 px-3 flex items-center text-sm">{selectedCompanyName}</div></LabeledSelect>}

            <LabeledSelect label="Empreendimento">
              <Select value={empreendimentoId} onValueChange={setEmpreendimentoId}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos</SelectItem>
                  {empreendimentos.map((empreendimento) => (
                    <SelectItem key={empreendimento.id} value={String(empreendimento.id)}>
                      {empreendimento.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabeledSelect>

            <LabeledSelect label="Tipo">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TYPE_ALL}>Todos</SelectItem>
                  <SelectItem value={TYPE_INBOUND}>Atendimento</SelectItem>
                  <SelectItem value={TYPE_ACTIVATION}>Ativação</SelectItem>
                </SelectContent>
              </Select>
            </LabeledSelect>

            <label className="space-y-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              De
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "h-9 w-full min-w-[150px] justify-start border-border bg-white text-left text-xs font-normal normal-case tracking-normal hover:bg-surface",
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
                    onSelect={(date) => {
                      if (date) setDateFrom(format(date, "yyyy-MM-dd"));
                    }}
                    initialFocus
                    className="pointer-events-auto p-3"
                  />
                </PopoverContent>
              </Popover>
            </label>

            <label className="space-y-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Até
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "h-9 w-full min-w-[150px] justify-start border-border bg-white text-left text-xs font-normal normal-case tracking-normal hover:bg-surface",
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
                    onSelect={(date) => {
                      if (date) setDateTo(format(date, "yyyy-MM-dd"));
                    }}
                    initialFocus
                    className="pointer-events-auto p-3"
                  />
                </PopoverContent>
              </Popover>
            </label>
          </div>

        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="text-base">Desdobramento do Funil</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {analysisQuery.isLoading ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Carregando análise...
            </div>
          ) : analysisQuery.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center text-sm text-destructive">
              Erro ao carregar os dados da análise.
            </div>
          ) : totals.received === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nenhum lead encontrado para os filtros selecionados.
            </div>
          ) : (
            <>
              <FunnelMetricRow
                label="Leads recebidos"
                value={totals.received}
                total={totals.received}
                color="bg-[#C14F21]"
              />
              <FunnelMetricRow
                label="Interagiram com a IA"
                value={totals.engaged}
                total={totals.received}
                color="bg-[#C14F21]"
              />
              <FunnelMetricRow
                label="Leads quentes"
                value={totals.hot}
                total={totals.received}
                color="bg-[#C14F21]"
              />
              <FunnelMetricRow
                label="Enviados ao corretor / CRM"
                value={totals.sentToCrm}
                total={totals.received}
                color="bg-[#2D7D52]"
              />
              <FunnelMetricRow
                label="Visitas agendadas"
                value={totals.scheduled}
                total={totals.received}
                color="bg-[#2D7D52]"
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LabeledSelect({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function FunnelMetricRow({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = percentage(value, total);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <span className="font-medium">{label}</span>
        <div className="text-sm text-muted-foreground">
          <span className="text-lg font-semibold text-foreground">{formatInteger(value)}</span>
          {" · "}
          {pct}%
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}
