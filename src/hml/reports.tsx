import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BarChart3, Download, RefreshCw } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { db, inputClass, secondaryClass, Notice } from "./modules";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { useCrmUser } from "@/hooks/use-crm-user";
import { formatLeadOrigin, LEAD_ORIGIN_OPTIONS } from "@/lib/lead-origin";

type ReportNavigation = {initialFrom?:string;initialTo?:string;onPeriodChange?:(from:string,to:string)=>void};

type Company = {
  id: number;
  name: string;
  ia: boolean;
  crm: boolean;
  developments: { id: number; name: string }[];
  stages: { id: number; name: string; module: string; funnel: string }[];
};
type Bucket = { name: string; total: number; funnel?: string; id?: number };
type Row = {
  id: number;
  nome: string;
  telefone: string;
  created_at: string;
  development: string;
  stage: string | null;
  owner: string | null;
  origin: string;
  interactions: number | null;
  qualification: number | null;
  human: boolean | null;
  opportunity_count: number | null;
};
type Report = {
  attribution: Attribution[];
  development_results: DevelopmentResult[];
  sentToCrm: number | null;
  scheduled: number | null;
  total: number;
  hot: number | null;
  engaged: number | null;
  qualified: number | null;
  human: number | null;
  opportunities: number | null;
  stages: Bucket[];
  developments: Bucket[];
  origins: Bucket[];
  origin_options: string[];
  daily: Bucket[];
  rows: Row[];
};
export type ReportView = "dashboard" | "funnel" | "leads" | "reports";
const titles = {
  dashboard: "Dashboard",
  funnel: "Análise de Funil",
  leads: "Relatório de Leads",
  reports: "Relatórios",
};
const links = [
  ["/dashboard", "Dashboard"],
  ["/analise-conversas", "Análise de Funil"],
  ["/relatorio-leads", "Relatório de Leads"],
  ["/relatorios", "Relatórios"],
] as const;
function day(offset = 0) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offset * 86400000));
}
function date(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
function quality(value: number | null) {
  return value === 1
    ? "Qualificado"
    : value === 2
      ? "Não qualificado"
      : value === 0
        ? "Pendente"
        : "Indisponível";
}
function csv(rows: Row[], module: string) {
  const cells = [
    [
      "ID",
      "Nome",
      "Telefone",
      "Criado em",
      "Empreendimento",
      "Etapa atual",
      "Responsável",
      "Origem",
      ...(module === "ia" ? ["Interações", "Qualificação", "Humano"] : ["Oportunidades"]),
    ],
    ...rows.map((r) => [
      r.id,
      r.nome,
      r.telefone,
      date(r.created_at),
      r.development,
      r.stage,
      r.owner,
      r.origin,
      ...(module === "ia"
        ? [
            r.interactions,
            quality(r.qualification),
            r.human == null ? "Indisponível" : r.human ? "Sim" : "Não",
          ]
        : [r.opportunity_count]),
    ]),
  ];
  const text = cells
    .map((line) =>
      line
        .map((v) => {
          let s = String(v ?? "");
          if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
          return '"' + s.replaceAll('"', '""') + '"';
        })
        .join(";"),
    )
    .join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "relatorio-pagina-atual.csv";
  a.click();
  URL.revokeObjectURL(url);
}
export function ReportsPage({ view, ...navigation }: { view: ReportView } & ReportNavigation) {
  const { data: me } = useCrmUser();
  const { activeEmpresaId } = useActiveEmpresa();
  const [analystCompany, setAnalystCompany] = useState("");
  const companies = useQuery({
    queryKey: ["report-companies", me?.id],
    enabled: !!me,
    queryFn: async () => {
      const { data, error } = await db.rpc("hub_report_companies");
      if (error) throw error;
      return data as Company[];
    },
    refetchInterval: 30000,
  });
  const company = companies.data?.find(
    (c) => c.id === (me?.role === "analyst" ? Number(analystCompany) : activeEmpresaId),
  );
  if (companies.isPending) return <p>Carregando relatórios…</p>;
  if (companies.isError)
    return (
      <Notice title="Não foi possível carregar as empresas">
        <button className={secondaryClass} onClick={() => companies.refetch()}>
          Tentar novamente
        </button>
      </Notice>
    );
  return (
    <div className="space-y-5">
      {me?.role === "analyst" && (
        <Field label="Empresa do relatório">
          <select
            className={inputClass}
            value={analystCompany}
            onChange={(e) => setAnalystCompany(e.target.value)}
          >
            <option value="">Selecione uma empresa autorizada</option>
            {companies.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {company ? (
        <>
        <ReportWorkspace
          key={`${company.id}:${me?.id}:${company.ia}:${company.crm}`}
          company={company}
          view={view}
          {...navigation}
        />
        </>
      ) : (
        <Notice title="Selecione uma empresa">
          Escolha uma empresa autorizada para consultar os relatórios.
        </Notice>
      )}
    </div>
  );
}
function ReportWorkspace({ company, view, initialFrom,initialTo,onPeriodChange }: { company: Company; view: ReportView } & ReportNavigation) {
  const { data: me } = useCrmUser();
  const [module, setModule] = useState(company.ia ? "ia" : "crm");
  const [from, setFrom] = useState(initialFrom || day(-29));
  const [to, setTo] = useState(initialTo || day());
  useEffect(()=>{setFrom(initialFrom||day(-29));setTo(initialTo||day());},[initialFrom,initialTo]);
  const periodChange=(start:string,end:string)=>{setFrom(start);setTo(end);setPage(0);onPeriodChange?.(start,end);};
  const [development, setDevelopment] = useState("");
  const [stage, setStage] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [qualification, setQualification] = useState("");
  const [human, setHuman] = useState("");
  const [origin, setOrigin] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const valid =
    !!from && !!to && from <= to && (Date.parse(to) - Date.parse(from)) / 86400000 <= 3660;
  const report = useQuery({
    queryKey: [
      "report-data",
      me?.id,
      company.id,
      module,
      from,
      to,
      development,
      stage,
      debounced,
      qualification,
      human,
      origin,
      page,
    ],
    enabled: valid,
    queryFn: async () => {
      const { data, error } = await db.rpc("hub_report_data", {
        p_company_id: company.id,
        p_module: module,
        p_from: from,
        p_to: to,
        p_development_id: development ? Number(development) : null,
        p_stage_id: stage ? Number(stage) : null,
        p_search: debounced,
        p_qualification: qualification,
        p_human: human,
        p_origin: origin,
        p_page: page,
      });
      if (error) throw error;
      return data as Report;
    },
    refetchInterval: 30000,
  });
  const change = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setPage(0);
  };
  const data = report.data;
  const reset = () => {
    periodChange(day(-29),day());
    setDevelopment("");
    setStage("");
    setSearch("");
    setDebounced("");
    setQualification("");
    setHuman("");
    setOrigin("");
    setPage(0);
  };
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-primary">
            {company.name}
          </p>
          <h1 className="text-2xl font-semibold">{titles[view]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {module === "ia" ? "Atendimento IA" : "CRM comercial"} · Dados de homologação
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {view === "reports"
              ? "Resultados agrupados por origem, anúncio e empreendimento."
              : view === "leads"
                ? "Consulta individual dos leads, com situação atual e exportação."
                : view === "funnel"
                  ? "Distribuição dos leads e oportunidades nas etapas do atendimento e da venda."
                  : "Resumo dos principais indicadores da empresa."}
          </p>
        </div>
        <button
          className={secondaryClass}
          disabled={report.isFetching || !valid}
          onClick={() => report.refetch()}
        >
          <RefreshCw size={15} /> Atualizar
        </button>
      </header>
      <nav aria-label="Relatórios" className="flex flex-wrap gap-2">
        {links.map(([to, label]) => (
          <Link
            key={to}
            to={to}
            className={`rounded-lg border px-3 py-2 text-sm ${titles[view] === label ? "border-primary/30 bg-primary/10 text-primary" : "bg-white text-muted-foreground"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <section
        aria-label="Filtros do relatório"
        className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Field label="Módulo">
          <select
            className={inputClass}
            value={module}
            onChange={(e) => {
              setModule(e.target.value);
              setStage("");
              setQualification("");
              setHuman("");
              setPage(0);
            }}
          >
            {company.ia && <option value="ia">Atendimento IA</option>}
            {company.crm && <option value="crm">CRM comercial</option>}
          </select>
        </Field>
        <Field label="De">
          <input
            className={inputClass}
            type="date"
            value={from}
            onChange={(e) => periodChange(e.target.value,to)}
          />
        </Field>
        <Field label="Até">
          <input
            className={inputClass}
            type="date"
            value={to}
            onChange={(e) => periodChange(from,e.target.value)}
          />
        </Field>
        <Field label="Empreendimento">
          <select
            className={inputClass}
            value={development}
            onChange={(e) => change(setDevelopment)(e.target.value)}
          >
            <option value="">Todos os empreendimentos</option>
            {company.developments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Etapa atual">
          <select
            className={inputClass}
            value={stage}
            onChange={(e) => change(setStage)(e.target.value)}
          >
            <option value="">Todas as etapas</option>
            {company.stages
              .filter((s) => s.module === module)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.funnel} · {s.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Buscar por nome, telefone ou ID">
          <input
            className={inputClass}
            value={search}
            maxLength={200}
            placeholder="Buscar…"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </Field>
        {module === "ia" && (
          <>
            <Field label="Qualificação">
              <select
                className={inputClass}
                value={qualification}
                onChange={(e) => change(setQualification)(e.target.value)}
              >
                <option value="">Todas</option>
                <option value="1">Qualificado</option>
                <option value="2">Não qualificado</option>
                <option value="0">Pendente</option>
                <option value="unknown">Indisponível</option>
              </select>
            </Field>
            <Field label="Atendimento humano">
              <select
                className={inputClass}
                value={human}
                onChange={(e) => change(setHuman)(e.target.value)}
              >
                <option value="">Todos</option>
                <option value="yes">Sim</option>
                <option value="no">Não</option>
                <option value="unknown">Indisponível</option>
              </select>
            </Field>
          </>
        )}
        <Field label="Origem cadastrada">
          <select
            className={inputClass}
            value={origin}
            onChange={(e) => change(setOrigin)(e.target.value)}
          >
            <option value="">Todas</option>
            {Array.from(
              new Set([...(data?.origin_options ?? []), ...(origin ? [origin] : [])]),
            ).map((o) => (
              <option key={o} value={o}>
                {o === "ND" ? "Não definida (ND)" : o}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end gap-2">
          <button className={secondaryClass} onClick={reset}>
            Limpar filtros
          </button>
        </div>
      </section>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Período pela criação do lead, no horário de Brasília, incluindo todo o dia final. Etapas e
        indicadores mostram o estado atual desses leads, não as movimentações ocorridas no período.{" "}
        {module === "crm"
          ? "Um lead pode ter várias oportunidades; os totais de etapas contam oportunidades."
          : "Jornada conforme o Hub: resposta do lead, interações/classificação ou evento de conversa; quente inclui qualificação. Conversão = visita agendada. Indicadores independentes, sem exigir passagem pela etapa anterior."}{" "}
        {me?.role === "agent" && "Exibindo somente seus atendimentos ou oportunidades atribuídas."}
      </p>
      {!valid ? (
        <Notice title="Confira o período">
          Informe datas em ordem, com intervalo máximo de 10 anos.
        </Notice>
      ) : report.isError ? (
        <Notice title="Não foi possível carregar o relatório">
          <p>{report.error.message}</p>
          <button className={secondaryClass} onClick={() => report.refetch()}>
            Tentar novamente
          </button>
        </Notice>
      ) : !data ? (
        <p role="status">Calculando indicadores…</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Leads no período" value={data.total} />
            <Metric
              label={module === "ia" ? "Leads quentes" : "Oportunidades"}
              value={module === "ia" ? data.hot : data.opportunities}
            />
            <Metric
              label={module === "ia" ? "Qualificados" : "Etapas com oportunidades"}
              value={
                module === "ia" ? data.qualified : data.stages.filter((s) => s.total > 0).length
              }
            />
            <Metric
              label={module === "ia" ? "Atendimento humano" : "Empreendimentos com leads"}
              value={module === "ia" ? data.human : data.developments.length}
            />
          </div>
          {data.total === 0 && (
            <Notice title="Nenhum lead encontrado">
              Ajuste os filtros ou o período para consultar outros registros.
            </Notice>
          )}
          {view === "reports" && <AttributionAndDevelopments data={data} module={module} />}
          {view !== "leads" && view !== "reports" && (
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <Bars
                title={
                  module === "ia"
                    ? "Leads por etapa de atendimento"
                    : "Oportunidades por etapa comercial"
                }
                rows={data.stages}
              />
              <Bars title="Leads por empreendimento" rows={data.developments} />
              {view === "funnel" && module === "ia" && (
                <Bars
                  title="Indicadores do atendimento"
                  rows={[
                    { name: "Leads recebidos", total: data.total },
                    { name: "Interação registrada", total: data.engaged ?? 0 },
                    { name: "Leads quentes", total: data.hot ?? 0 },
                    { name: "Qualificados", total: data.qualified ?? 0 },
                    { name: "Enviados ao corretor / CRM", total: data.sentToCrm ?? 0 },
                    { name: "Visitas agendadas", total: data.scheduled ?? 0 },
                  ]}
                />
              )}
              {view === "dashboard" && (
                <>
                  <Bars
                    title="Origem cadastrada no lead"
                    rows={data.origins.map((o) => ({
                      ...o,
                      name: o.name === "ND" ? "Não definida (ND)" : o.name,
                    }))}
                  />
                  <Bars
                    title="Leads criados por dia"
                    rows={data.daily.map((d) => ({
                      ...d,
                      name: d.name.split("-").reverse().join("/"),
                    }))}
                  />
                </>
              )}
            </div>
          )}
          {view === "leads" && (
            <section className="overflow-hidden rounded-2xl border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                <p className="text-sm">{data.total} leads · até 50 por página</p>
                <button
                  className={secondaryClass}
                  disabled={!data.rows.length || report.isFetching || search !== debounced}
                  onClick={() => csv(data.rows, module)}
                >
                  <Download size={15} /> Exportar página atual
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      {[
                        "ID",
                        "Lead",
                        "Empreendimento",
                        "Etapa atual",
                        "Responsável",
                        "Criado em",
                        ...(module === "ia"
                          ? ["Interações", "Qualificação", "Humano"]
                          : ["Oportunidades"]),
                      ].map((h) => (
                        <th className="whitespace-nowrap p-3" key={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr className="border-t hover:bg-muted/20" key={r.id}>
                        <td className="p-3">#{r.id}</td>
                        <td className="p-3">
                          <span className="font-medium">{r.nome}</span>
                          <div className="text-xs text-muted-foreground">{r.telefone}</div>
                        </td>
                        <td className="p-3">{r.development}</td>
                        <td className="p-3">{r.stage ?? "Sem etapa"}</td>
                        <td className="p-3">{r.owner ?? "Sem responsável"}</td>
                        <td className="whitespace-nowrap p-3">{date(r.created_at)}</td>
                        {module === "ia" ? (
                          <>
                            <td className="p-3">{r.interactions ?? "Indisponível"}</td>
                            <td className="p-3">{quality(r.qualification)}</td>
                            <td className="p-3">
                              {r.human == null ? "Indisponível" : r.human ? "Sim" : "Não"}
                            </td>
                          </>
                        ) : (
                          <td className="p-3">{r.opportunity_count}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t p-4">
                <button
                  className={secondaryClass}
                  disabled={!page || report.isFetching}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Anterior
                </button>
                <span className="text-sm">
                  Página {page + 1} de {Math.max(1, Math.ceil(data.total / 50))}
                </span>
                <button
                  className={secondaryClass}
                  disabled={(page + 1) * 50 >= data.total || report.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                </button>
              </div>
            </section>
          )}
        </>
      )}
      <section className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm">
        <h2 className="font-medium">Dados de homologação</h2>
        <p className="mt-1 leading-relaxed text-muted-foreground">
          {module === "ia"
            ? "Campanhas, visitas e eventos são calculados sobre registros de teste identificados. Bloqueios e follow-ups executados ainda não estão disponíveis neste relatório. "
            : "Ganhos, perdas, valores e tempo de fechamento precisam de regras comerciais e fontes próprias. "}
          Não há importação contínua da produção. O recebimento de campanhas e eventos reais depende
          da integração de produção e de sua validação antes da troca do Hub.
        </p>
      </section>
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold">
        {value == null ? "Indisponível" : value.toLocaleString("pt-BR")}
      </div>
    </div>
  );
}
function Bars({ title, rows }: { title: string; rows: Bucket[] }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <section className="rounded-2xl border bg-white p-5">
      <h2 className="mb-5 flex items-center gap-2 font-semibold">
        <BarChart3 size={17} className="text-primary" />
        {title}
      </h2>
      <div className="max-h-80 space-y-4 overflow-auto">
        {rows.map((r, index) => (
          <div key={r.id ?? `${r.name}:${index}`}>
            <div className="mb-1 flex justify-between gap-3 text-sm">
              <span>
                {r.funnel && <span className="text-muted-foreground">{r.funnel} · </span>}
                {r.name}
              </span>
              <strong>{r.total}</strong>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/80"
                style={{ width: `${(100 * r.total) / max}%` }}
              />
            </div>
          </div>
        ))}
        {!rows.length && (
          <p className="text-sm text-muted-foreground">Sem registros para este filtro.</p>
        )}
      </div>
    </section>
  );
}

type Attribution = {
  origin: string;
  source: string;
  platform: string;
  campaign: string;
  adset: string;
  ad: string;
  received: number;
  engaged: number | null;
  hot: number | null;
  sentToCrm: number | null;
  scheduled: number | null;
};
type DevelopmentResult = {
  id: number | null;
  name: string;
  total: number;
  converted: number | null;
  lost: number | null;
  ongoing: number | null;
};
const journeyLabels = [
  ["received", "Leads recebidos"],
  ["engaged", "Interagindo com a IA"],
  ["hot", "Leads quentes"],
  ["sentToCrm", "Enviados ao corretor"],
  ["scheduled", "Visitas agendadas"],
] as const;
const attributionColumns = [
  ["origin", "Origem"],
  ["source", "Fonte"],
  ["platform", "Plataforma"],
  ["campaign", "Campanha"],
  ["adset", "Conjunto de anúncios"],
  ["ad", "Anúncio / conteúdo"],
] as const;
function originName(value: string) {
  return LEAD_ORIGIN_OPTIONS.some((o) => o.value === value) ? formatLeadOrigin(value) : value;
}
function percent(n: number, total: number) {
  return (
    (total ? (n * 100) / total : 0).toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + "%"
  );
}
function AttributionAndDevelopments({ data, module }: { data: Report; module: string }) {
  const [horizontal, setHorizontal] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState("received");
  const [descending, setDescending] = useState(true);
  const [developmentSort, setDevelopmentSort] = useState("total");
  const [developmentDescending, setDevelopmentDescending] = useState(true);
  const colors = ["#c14f21", "#e68f6a", "#f2b9a3", "#a3421c", "#d96d3e", "#7a3115"];
  const allRows = data.attribution.map((r) => ({ ...r, origin: originName(r.origin) }));
  const rows = allRows
    .filter((r) =>
      Object.entries(filters).every(
        ([key, value]) => !value || r[key as keyof Attribution] === value,
      ),
    )
    .sort((a, b) => {
      const av = a[sort as keyof Attribution],
        bv = b[sort as keyof Attribution];
      return (
        (descending ? -1 : 1) *
        (typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv, "pt-BR")
          : Number(av) - Number(bv))
      );
    });
  const developmentRows = [...data.development_results].sort((a, b) => {
    const av =
      developmentSort === "rate"
        ? (a.converted ?? 0) / a.total
        : a[developmentSort as keyof DevelopmentResult];
    const bv =
      developmentSort === "rate"
        ? (b.converted ?? 0) / b.total
        : b[developmentSort as keyof DevelopmentResult];
    return (
      (developmentDescending ? -1 : 1) *
      (typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv, "pt-BR")
        : Number(av) - Number(bv))
    );
  });
  const shown = rows.reduce((n, r) => n + r.received, 0);
  const totals = data.development_results.reduce(
    (t, r) => ({
      converted: t.converted + (r.converted ?? 0),
      lost: t.lost + (r.lost ?? 0),
      ongoing: t.ongoing + (r.ongoing ?? 0),
    }),
    { converted: 0, lost: 0, ongoing: 0 },
  );
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Leads por origem e anúncio</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Atribuição dos leads recebidos no período · registros de homologação
            </p>
          </div>
          {module === "ia" && (
            <div className="flex gap-2">
              <button
                aria-pressed={!horizontal}
                className={secondaryClass}
                onClick={() => setHorizontal(false)}
              >
                Etapas em lista
              </button>
              <button
                aria-pressed={horizontal}
                className={secondaryClass}
                onClick={() => setHorizontal(true)}
              >
                Etapas em colunas
              </button>
            </div>
          )}
        </div>
        <div className="my-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {attributionColumns.map(([key, label]) => (
            <Field key={key} label={label}>
              <select
                className={inputClass}
                value={filters[key] ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
              >
                <option value="">Todas</option>
                {Array.from(new Set(allRows.map((r) => r[key])))
                  .sort()
                  .map((value) => (
                    <option key={value}>{value}</option>
                  ))}
              </select>
            </Field>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            {rows.length} grupos · {shown} de {data.total} leads. Participação sobre todos os leads
            do filtro geral; etapas sobre os leads de cada grupo.
          </span>
          <button className="cursor-pointer text-primary underline" onClick={() => setFilters({})}>
            Limpar filtros de atribuição
          </button>
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40">
              <tr>
                {[
                  ...attributionColumns,
                  ["received", "Leads"] as const,
                  ...(module === "ia" && horizontal ? journeyLabels.slice(1) : []),
                ].map(([key, label]) => (
                  <th
                    key={key}
                    className="whitespace-nowrap p-3"
                    aria-sort={sort === key ? (descending ? "descending" : "ascending") : "none"}
                  >
                    <button
                      className="cursor-pointer font-medium"
                      onClick={() => {
                        setSort(key);
                        setDescending(sort === key ? !descending : true);
                      }}
                    >
                      {label} {sort === key ? (descending ? "↓" : "↑") : ""}
                    </button>
                  </th>
                ))}
                {module === "ia" && !horizontal && (
                  <th className="p-3 font-medium">Leads por etapa</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={JSON.stringify([r.origin, r.source, r.campaign, r.adset, r.ad])}
                  className="border-t align-top"
                >
                  {attributionColumns.map(([key]) => (
                    <td key={key} className="min-w-36 max-w-64 break-words p-3">
                      {r[key]}
                    </td>
                  ))}
                  <td className="whitespace-nowrap p-3 font-medium">
                    {r.received}{" "}
                    <span className="text-xs font-normal">({percent(r.received, data.total)})</span>
                  </td>
                  {module === "ia" &&
                    (horizontal ? (
                      journeyLabels.slice(1).map(([key]) => (
                        <td key={key} className="whitespace-nowrap p-3">
                          {r[key]} ({percent(r[key] ?? 0, r.received)})
                        </td>
                      ))
                    ) : (
                      <td className="min-w-64 p-3">
                        <ul className="space-y-1 text-xs">
                          {journeyLabels.map(([key, label]) => (
                            <li key={key} className="flex justify-between gap-4">
                              <span>
                                <span
                                  className={`mr-1 inline-block h-2 w-2 rounded-full ${key === "scheduled" || key === "sentToCrm" ? "bg-green-700" : "bg-primary"}`}
                                />
                                {label}
                              </span>
                              <span>
                                {r[key]} ({percent(r[key] ?? 0, r.received)})
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    ))}
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={attributionColumns.length+1+(module==='ia'?(horizontal?journeyLabels.length:1):0)} className="p-5 text-muted-foreground">
                    Nenhuma atribuição corresponde aos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-semibold">Leads por Empreendimento</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {module === "ia"
            ? "Conversão = visita agendada. Visita tem prioridade sobre perda; demais leads ficam em andamento."
            : "Distribuição dos leads com oportunidades comerciais."}
        </p>
        <div className="mt-5 grid items-center gap-5 lg:grid-cols-2">
          <div>
            {developmentRows.length ? (
              <div className="h-56" aria-label="Distribuição de leads por empreendimento">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={developmentRows}
                      dataKey="total"
                      nameKey="name"
                      innerRadius={62}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {developmentRows.map((r, i) => (
                        <Cell key={r.id ?? "none"} fill={colors[i % colors.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-8 text-sm text-muted-foreground">Nenhum lead no período.</p>
            )}
            <ul className="space-y-1 text-xs">
              {developmentRows.map((r, i) => (
                <li key={r.id ?? "none"} className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: colors[i % colors.length] }}
                  />
                  {r.name} — {r.total} ({percent(r.total, data.total)})
                </li>
              ))}
            </ul>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  {[
                    ["name", "Empreendimento"],
                    ["total", "Total"],
                    ...(module === "ia"
                      ? [
                          ["ongoing", "Em and."],
                          ["converted", "Conv."],
                          ["lost", "Perd."],
                          ["rate", "Taxa"],
                        ]
                      : []),
                  ].map(([key, label]) => (
                    <th
                      key={key}
                      className="p-2 font-medium"
                      aria-sort={
                        developmentSort === key
                          ? developmentDescending
                            ? "descending"
                            : "ascending"
                          : "none"
                      }
                    >
                      <button
                        className="cursor-pointer whitespace-nowrap"
                        onClick={() => {
                          setDevelopmentSort(key);
                          setDevelopmentDescending(
                            developmentSort === key ? !developmentDescending : true,
                          );
                        }}
                      >
                        {label} {developmentSort === key ? (developmentDescending ? "↓" : "↑") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {developmentRows.map((r) => (
                  <tr key={r.id ?? "none"} className="border-b">
                    <td className="p-2">{r.name}</td>
                    <td className="p-2">{r.total}</td>
                    {module === "ia" && (
                      <>
                        <td className="p-2">{r.ongoing}</td>
                        <td className="p-2">{r.converted}</td>
                        <td className="p-2">{r.lost}</td>
                        <td className="p-2">{percent(r.converted ?? 0, r.total)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="p-2">Total</td>
                  <td className="p-2">{data.total}</td>
                  {module === "ia" && (
                    <>
                      <td className="p-2">{totals.ongoing}</td>
                      <td className="p-2">{totals.converted}</td>
                      <td className="p-2">{totals.lost}</td>
                      <td className="p-2">{percent(totals.converted, data.total)}</td>
                    </>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

