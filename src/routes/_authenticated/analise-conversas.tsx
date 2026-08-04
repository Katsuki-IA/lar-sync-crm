import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/analise-conversas")({
  component: ConversationAnalysisPage,
});

type EmpreendimentoRow = Pick<Database["public"]["Tables"]["empreendimento"]["Row"], "id" | "nome" | "id_empresa">;
type LeadRow = Pick<
  Database["public"]["Tables"]["lead"]["Row"],
  | "id"
  | "id_empresa"
  | "id_empreendimento"
  | "empreendimento_em_foco_id"
  | "empreendimento_em_foco_nome"
  | "nome"
  | "numero"
  | "email"
  | "qtd_interacoes"
  | "qualificado"
  | "status"
  | "status_history"
  | "ativacao"
  | "created_at"
  | "updated_at"
  | "last_message_timestamp"
  | "ult_message"
>;
type ChatRow = Pick<Database["public"]["Tables"]["n8n_chat_conversas"]["Row"], "id" | "numero" | "type" | "message" | "time" | "created_at">;
type AgendamentoRow = Pick<Database["public"]["Tables"]["agendamento"]["Row"], "id_lead" | "id_empresa" | "id_empreendimento" | "deleted_at">;
type ClassificationRow = Pick<
  Database["public"]["Tables"]["crm_conversation_classifications"]["Row"],
  | "lead_id"
  | "cliente_respondeu"
  | "nao_respondeu_mais"
  | "lead_desqualificado"
  | "qualificado"
  | "visita_agendada"
  | "temperatura"
  | "resumo"
  | "classified_at"
>;

type ConversationAnalysis = {
  lead: LeadRow;
  empreendimentoName: string;
  sessionId: string;
  messages: ChatRow[];
  messageCount: number;
  humanCount: number;
  aiCount: number;
  firstAt: string | null;
  lastAt: string | null;
  hasHuman: boolean;
  noResponse: boolean;
  qualified: boolean;
  disqualified: boolean;
  visitScheduled: boolean;
  hasLabel: boolean;
  classification: ClassificationRow | null;
};

const ALL = "all";
const TYPE_ALL = "all";
const TYPE_INBOUND = "inbound";
const TYPE_ACTIVATION = "activation";

function onlyDigits(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

function phoneVariants(value?: string | null) {
  const digits = onlyDigits(value);
  if (!digits) return [];
  const variants = new Set<string>([digits]);
  if (digits.length > 11) variants.add(digits.slice(-11));
  return [...variants];
}

function sessionIdForLead(lead: LeadRow) {
  const phone = phoneVariants(lead.numero)[0];
  return phone ? `${phone}${lead.id_empresa}` : "";
}

function parseDateValue(value?: string | null) {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const asNumber = Number(value);
    const date = new Date(asNumber > 9_999_999_999 ? asNumber : asNumber * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

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

function historyIncludes(lead: LeadRow, term: string) {
  return (lead.status_history ?? "").toLowerCase().includes(term.toLowerCase());
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function withinDateRange(value: string | null, from: string, to: string) {
  const date = parseDateValue(value);
  if (!date) return false;
  const start = from ? new Date(`${from}T00:00:00`) : null;
  const end = to ? new Date(`${to}T23:59:59.999`) : null;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

async function fetchMessages(sessionIds: string[]) {
  if (!sessionIds.length) return [];
  const rows: ChatRow[] = [];
  for (const group of chunk([...new Set(sessionIds)], 80)) {
    const { data, error } = await supabase
      .from("n8n_chat_conversas")
      .select("id,numero,type,message,time,created_at")
      .in("numero", group)
      .order("time", { ascending: true });
    if (error) throw error;
    rows.push(...((data ?? []) as ChatRow[]));
  }
  return rows;
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
  const empreendimentoNameById = useMemo(
    () => new Map(empreendimentos.map((item) => [item.id, item.nome])),
    [empreendimentos],
  );

  const analysisQuery = useQuery({
    enabled: !!companyId && canView,
    queryKey: ["conversation-analysis", companyId, empreendimentoId, typeFilter, dateFrom, dateTo],
    queryFn: async () => {
      if (!companyId) return [] as ConversationAnalysis[];

      let leadQuery = supabase
        .from("lead")
        .select(
          "id,id_empresa,id_empreendimento,empreendimento_em_foco_id,empreendimento_em_foco_nome,nome,numero,email,qtd_interacoes,qualificado,status,status_history,ativacao,created_at,updated_at,last_message_timestamp,ult_message",
        )
        .eq("id_empresa", companyId)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1000);

      if (empreendimentoId !== ALL) {
        leadQuery = leadQuery.or(
          `id_empreendimento.eq.${empreendimentoId},empreendimento_em_foco_id.eq.${empreendimentoId}`,
        );
      }
      if (typeFilter === TYPE_INBOUND) leadQuery = leadQuery.eq("ativacao", false);
      if (typeFilter === TYPE_ACTIVATION) leadQuery = leadQuery.eq("ativacao", true);

      const { data: leadRows, error: leadError } = await leadQuery;
      if (leadError) throw leadError;

      const leads = (leadRows ?? []) as LeadRow[];
      const sessionIdByLeadId = new Map(
        leads.map((lead) => [lead.id, sessionIdForLead(lead)]),
      );
      const sessionIds = [...sessionIdByLeadId.values()].filter(Boolean);
      const messages = await fetchMessages(sessionIds);
      const messagesBySession = new Map<string, ChatRow[]>();

      for (const message of messages) {
        if (!message.numero) continue;
        const group = messagesBySession.get(message.numero) ?? [];
        group.push(message);
        messagesBySession.set(message.numero, group);
      }

      const leadIds = leads.map((lead) => lead.id);
      let scheduledLeadIds = new Set<number>();
      if (leadIds.length) {
        const appointments: AgendamentoRow[] = [];
        for (const group of chunk(leadIds, 100)) {
          const { data: appointmentRows, error: appointmentError } = await supabase
            .from("agendamento")
            .select("id_lead,id_empresa,id_empreendimento,deleted_at")
            .eq("id_empresa", companyId)
            .is("deleted_at", null)
            .in("id_lead", group);
          if (appointmentError) throw appointmentError;
          appointments.push(...((appointmentRows ?? []) as AgendamentoRow[]));
        }
        scheduledLeadIds = new Set(appointments.map((appointment) => appointment.id_lead).filter((id): id is number => id != null));
      }

      const classificationsByLead = new Map<number, ClassificationRow>();
      if (leadIds.length) {
        for (const group of chunk(leadIds, 100)) {
          const { data: classificationRows, error: classificationError } = await supabase
            .from("crm_conversation_classifications")
            .select(
              "lead_id,cliente_respondeu,nao_respondeu_mais,lead_desqualificado,qualificado,visita_agendada,temperatura,resumo,classified_at",
            )
            .eq("id_empresa", companyId)
            .in("lead_id", group);

          if (classificationError) {
            const errorCode = (classificationError as { code?: string }).code;
            const message = classificationError.message ?? "";
            if (errorCode === "42P01" || errorCode === "PGRST205" || message.includes("crm_conversation_classifications")) {
              break;
            }
            throw classificationError;
          }

          for (const row of classificationRows ?? []) classificationsByLead.set(row.lead_id, row as ClassificationRow);
        }
      }

      return leads
        .map((lead) => {
          const sessionId = sessionIdByLeadId.get(lead.id) ?? "";
          const leadMessages = messagesBySession.get(sessionId) ?? [];
          const firstMessage = leadMessages[0];
          const lastMessage = leadMessages.at(-1);
          const firstAt = firstMessage?.time ?? firstMessage?.created_at ?? null;
          const lastAt = lastMessage?.time ?? lastMessage?.created_at ?? lead.last_message_timestamp ?? lead.updated_at ?? lead.created_at;
          const storedInteractionCount = Math.max(lead.qtd_interacoes ?? 0, 0);
          const messageCount = leadMessages.length || storedInteractionCount;
          const humanCount = leadMessages.filter((message) => message.type === "human").length;
          const aiCount = leadMessages.filter((message) => message.type === "ai").length;
          const lastMessageFromHuman = String(lastMessage?.type ?? "").toLowerCase() === "human";
          const classification = classificationsByLead.get(lead.id) ?? null;
          const fallbackHasHuman = humanCount > 0 || storedInteractionCount >= 2;
          const qualified =
            Boolean(classification?.qualificado) ||
            lead.qualificado === 1 ||
            (historyIncludes(lead, "Qualificado") && !historyIncludes(lead, "Desqualificado"));
          const disqualified =
            Boolean(classification?.lead_desqualificado) ||
            historyIncludes(lead, "Desqualificado") ||
            historyIncludes(lead, "Perdido");
          const visitScheduled =
            Boolean(classification?.visita_agendada) ||
            scheduledLeadIds.has(lead.id) ||
            historyIncludes(lead, "Visita Agendada");
          const hasHuman = Boolean(classification?.cliente_respondeu) || fallbackHasHuman;
          const noResponse =
            hasHuman &&
            !lastMessageFromHuman &&
            !qualified &&
            !disqualified &&
            !visitScheduled &&
            (classification ? classification.nao_respondeu_mais : true);
          const hasLabel = Boolean(classification || lead.status_history || qualified || disqualified || visitScheduled);
          const empreendimentoName =
            (lead.id_empreendimento ? empreendimentoNameById.get(lead.id_empreendimento) : null) ??
            (lead.empreendimento_em_foco_id ? empreendimentoNameById.get(lead.empreendimento_em_foco_id) : null) ??
            lead.empreendimento_em_foco_nome ??
            "Sem empreendimento";

          return {
            lead,
            empreendimentoName,
            sessionId,
            messages: leadMessages,
            messageCount,
            humanCount,
            aiCount,
            firstAt,
            lastAt,
            hasHuman,
            noResponse,
            qualified,
            disqualified,
            visitScheduled,
            hasLabel,
            classification,
          };
        })
        .filter((item) => withinDateRange(item.lastAt, dateFrom, dateTo))
        .sort((a, b) => (parseDateValue(b.lastAt)?.getTime() ?? 0) - (parseDateValue(a.lastAt)?.getTime() ?? 0));
    },
  });

  const conversations = analysisQuery.data ?? [];
  const totals = useMemo(() => {
    const total = conversations.length;
    const engaged = conversations.filter((item) => item.hasHuman).length;
    const hot = conversations.filter((item) => item.qualified).length;
    const scheduled = conversations.filter((item) => item.visitScheduled).length;

    return {
      total,
      engaged,
      hot,
      scheduled,
    };
  }, [conversations]);

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
          ) : totals.total === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nenhum lead encontrado para os filtros selecionados.
            </div>
          ) : (
            <>
              <FunnelMetricRow
                label="Interagiram com a IA"
                value={totals.engaged}
                total={totals.total}
                color="bg-[#C14F21]"
              />
              <FunnelMetricRow
                label="Leads quentes"
                value={totals.hot}
                total={totals.total}
                color="bg-[#C14F21]"
              />
              <FunnelMetricRow
                label="Visitas agendadas"
                value={totals.scheduled}
                total={totals.total}
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
