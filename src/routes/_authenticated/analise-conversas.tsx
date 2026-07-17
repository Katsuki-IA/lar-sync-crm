import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  Download,
  MessageCircle,
  Send,
  Sparkles,
  Tags,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { useCrmUser } from "@/hooks/use-crm-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/analise-conversas")({
  component: ConversationAnalysisPage,
});

type EmpresaRow = Pick<Database["public"]["Tables"]["empresa_dados"]["Row"], "id" | "nome">;
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
  qualified: boolean;
  disqualified: boolean;
  visitScheduled: boolean;
  hasLabel: boolean;
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
  const { data: allowed } = useAllowedEmpresas();
  const isSuperAdmin = me?.role === "super_admin";
  const canView = me?.role === "manager" || me?.role === "super_admin";
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [empreendimentoId, setEmpreendimentoId] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<string>(TYPE_ALL);
  const [dateFrom, setDateFrom] = useState(defaultStartDate);
  const [dateTo, setDateTo] = useState(defaultEndDate);

  const companiesQuery = useQuery({
    enabled: !!allowed?.length && canView,
    queryKey: ["analysis-companies", allowed],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresa_dados")
        .select("id,nome")
        .in("id", allowed ?? [])
        .order("nome");
      if (error) throw error;
      return (data ?? []) as EmpresaRow[];
    },
  });

  const companies = companiesQuery.data ?? [];

  useEffect(() => {
    if (!me || !allowed) return;
    const nextCompanyId = isSuperAdmin
      ? (companies.find((company) => company.id === companyId)?.id ?? companies[0]?.id ?? null)
      : (me.id_empresa ?? null);
    if (nextCompanyId !== companyId) {
      setCompanyId(nextCompanyId);
      setEmpreendimentoId(ALL);
    }
  }, [allowed, companies, companyId, isSuperAdmin, me]);

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
      const leadsWithSession = leads
        .map((lead) => ({ lead, sessionId: sessionIdForLead(lead) }))
        .filter((item) => item.sessionId);
      const sessionIds = leadsWithSession.map((item) => item.sessionId);
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

      return leadsWithSession
        .map(({ lead, sessionId }) => {
          const leadMessages = messagesBySession.get(sessionId) ?? [];
          const firstMessage = leadMessages[0];
          const lastMessage = leadMessages.at(-1);
          const firstAt = firstMessage?.time ?? firstMessage?.created_at ?? null;
          const lastAt = lastMessage?.time ?? lastMessage?.created_at ?? lead.last_message_timestamp ?? lead.updated_at ?? lead.created_at;
          const storedInteractionCount = Math.max(lead.qtd_interacoes ?? 0, 0);
          const messageCount = leadMessages.length || storedInteractionCount;
          const humanCount = leadMessages.filter((message) => message.type === "human").length;
          const aiCount = leadMessages.filter((message) => message.type === "ai").length;
          const qualified = lead.qualificado === 1 || (historyIncludes(lead, "Qualificado") && !historyIncludes(lead, "Desqualificado"));
          const disqualified = historyIncludes(lead, "Desqualificado") || historyIncludes(lead, "Perdido");
          const visitScheduled = scheduledLeadIds.has(lead.id) || historyIncludes(lead, "Visita Agendada");
          const hasLabel = Boolean(lead.status_history || qualified || disqualified || visitScheduled);
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
            hasHuman: humanCount > 0 || storedInteractionCount >= 2,
            qualified,
            disqualified,
            visitScheduled,
            hasLabel,
          };
        })
        .filter((item) => withinDateRange(item.lastAt, dateFrom, dateTo))
        .sort((a, b) => (parseDateValue(b.lastAt)?.getTime() ?? 0) - (parseDateValue(a.lastAt)?.getTime() ?? 0));
    },
  });

  const conversations = analysisQuery.data ?? [];
  const totals = useMemo(() => {
    const total = conversations.length;
    const messages = conversations.reduce((sum, item) => sum + item.messageCount, 0);
    const withLabel = conversations.filter((item) => item.hasLabel).length;
    const responded = conversations.filter((item) => item.hasHuman).length;
    const noResponse = conversations.filter((item) => !item.hasHuman).length;
    const disqualified = conversations.filter((item) => item.disqualified).length;
    const qualified = conversations.filter((item) => item.qualified).length;
    const scheduled = conversations.filter((item) => item.visitScheduled).length;

    return {
      total,
      messages,
      withLabel,
      withoutLabel: Math.max(total - withLabel, 0),
      responded,
      noResponse,
      disqualified,
      qualified,
      scheduled,
    };
  }, [conversations]);

  const selectedCompanyName = companies.find((company) => company.id === companyId)?.nome ?? "empresa";
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
          <h1 className="text-2xl font-semibold tracking-tight">Análise de Conversas</h1>
          <p className="text-sm text-muted-foreground">
            Análise de {selectedEmpreendimentoName} em {selectedCompanyName}.
          </p>
        </div>
        <Badge variant="outline" className="w-fit bg-background">
          {formatInteger(totals.total)} conversa{totals.total === 1 ? "" : "s"}
        </Badge>
      </div>

      <Card className="rounded-xl">
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {isSuperAdmin ? (
              <LabeledSelect label="Empresa">
                <Select value={companyId ? String(companyId) : ""} onValueChange={(value) => setCompanyId(Number(value))}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Selecione a empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={String(company.id)}>
                        {company.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </LabeledSelect>
            ) : null}

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
              <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="bg-white normal-case tracking-normal" />
            </label>

            <label className="space-y-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Até
              <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="bg-white normal-case tracking-normal" />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled>
              <Sparkles className="mr-2 h-4 w-4" />
              Classificar 30 conversa(s) com IA
            </Button>
            <Button type="button" variant="outline" disabled>
              <Download className="mr-2 h-4 w-4" />
              Exportar relatório
            </Button>
            <Button type="button" variant="outline" disabled>
              <Send className="mr-2 h-4 w-4" />
              Enviar por WhatsApp
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={MessageCircle} label="Total Conversas" value={totals.total} />
        <MetricCard icon={TrendingUp} label="Total Mensagens" value={totals.messages} />
        <MetricCard icon={Tags} label="Com etiqueta" value={totals.withLabel} />
        <MetricCard icon={BarChart3} label="Sem etiqueta" value={totals.withoutLabel} />
      </div>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="text-base">Desdobramento de Conversas</CardTitle>
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
              Nenhuma conversa encontrada para os filtros selecionados.
            </div>
          ) : (
            <>
              <BreakdownRow label="Cliente respondeu" value={totals.responded} total={totals.total} goalText="META >= 50%" tone="green" />
              <BreakdownRow label="Não respondeu" value={totals.noResponse} total={totals.total} goalText="META < 30%" tone="green" />
              <BreakdownRow label="Lead desqualificado" value={totals.disqualified} total={totals.total} goalText="META < 20%" tone="green" />
              <BreakdownRow label="Qualificado" value={totals.qualified} total={totals.total} goalText="META > 50%" tone="red" />
              <div className="border-l-2 border-green-500 pl-4">
                <BreakdownRow
                  label="Visita agendada"
                  value={totals.scheduled}
                  total={Math.max(totals.qualified, 1)}
                  countText={`${totals.scheduled} — dos qualificados`}
                  goalText="META > 30%"
                  tone="green"
                />
              </div>
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

function MetricCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <Card className="rounded-xl">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{formatInteger(value)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function BreakdownRow({
  label,
  value,
  total,
  goalText,
  countText,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  goalText: string;
  countText?: string;
  tone: "green" | "red";
}) {
  const pct = percentage(value, total);
  const color = tone === "green" ? "bg-green-500" : "bg-red-500";
  const textColor = tone === "green" ? "text-green-600" : "text-red-500";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn("h-3 w-3 rounded-full", color)} />
          <span className="font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">({goalText})</span>
        </div>
        <div className="text-sm text-muted-foreground">
          <span className={cn("mr-2 text-lg font-semibold", textColor)}>{pct}%</span>
          ({countText ?? `${value} de ${total}`})
        </div>
      </div>
      <div className="h-6 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}
