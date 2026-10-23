import { NativeReportsBoundary } from "@/hml/native-reports-boundary";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";

import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { useCrmUser } from "@/hooks/use-crm-user";
import { getLeadReport, type LeadReportRow } from "@/lib/lead-report.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/relatorio-leads")({
  component: () => <NativeReportsBoundary><LeadReportPage /></NativeReportsBoundary>,
});

const ALL = "all";
const PAGE_SIZE = 50;
const EMPTY_ROWS: LeadReportRow[] = [];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function defaultFrom() {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return dateKey(date);
}

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(value))
    : "—";
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv(rows: LeadReportRow[]) {
  const header = [
    "ID interno",
    "ID CRM externo",
    "Nome",
    "Telefone",
    "Criado em",
    "Empreendimento",
    "Estado atual no sistema",
    "Interações",
    "Qualificação",
    "Atendimento humano",
    "Bloqueado",
    "Motivo do bloqueio",
    "Visita",
    "Datas das visitas ativas",
    "Follow-ups registrados",
  ];
  const lines = [
    header,
    ...rows.map((row) => [
      row.id,
      row.crmId,
      row.nome,
      row.numero,
      formatDate(row.createdAt),
      row.empreendimento,
      row.stage,
      row.interactions,
      qualificationLabel(row.qualification),
      row.human ? "Sim" : "Não",
      row.blocked ? "Sim" : "Não",
      row.blockReason,
      visitLabel(row.visit),
      row.visitDays.join(" | "),
      row.followups.join(" | "),
    ]),
  ].map((values) => values.map(csvCell).join(";"));
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "relatorio-de-leads.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function qualificationLabel(value: LeadReportRow["qualification"]) {
  return value === "qualified"
    ? "Qualificado"
    : value === "disqualified"
      ? "Não qualificado"
      : "Pendente";
}

function visitLabel(value: LeadReportRow["visit"]) {
  return value === "active"
    ? "Agendamento registrado"
    : value === "cancelled"
      ? "Agendamento cancelado"
      : "Sem agendamento";
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="space-y-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="bg-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function LeadReportPage() {
  const { data: me } = useCrmUser();
  const { activeEmpresaId, activeEmpresa, empresas, isSuperAdmin, setActiveEmpresaId } =
    useActiveEmpresa();
  const reportFn = useServerFn(getLeadReport);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(() => dateKey(new Date()));
  const [project, setProject] = useState(ALL);
  const [stage, setStage] = useState(ALL);
  const [visit, setVisit] = useState(ALL);
  const [blocked, setBlocked] = useState(ALL);
  const [attended, setAttended] = useState(ALL);
  const [lost, setLost] = useState(ALL);
  const [human, setHuman] = useState(ALL);
  const [qualification, setQualification] = useState(ALL);
  const [followup, setFollowup] = useState(ALL);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const canView = me?.role === "manager" || me?.role === "super_admin" || me?.role === "analyst";
  const report = useQuery({
    enabled: !!activeEmpresaId && canView && !!dateFrom && !!dateTo && dateFrom <= dateTo,
    queryKey: ["lead-report", activeEmpresaId, dateFrom, dateTo],
    queryFn: () => reportFn({ data: { companyId: activeEmpresaId!, dateFrom, dateTo } }),
  });
  const rows = report.data ?? EMPTY_ROWS;
  const projects = useMemo(
    () =>
      [...new Map(rows.map((row) => [row.empreendimentoId, row.empreendimento])).entries()]
        .filter(([id]) => id != null)
        .map(([id, name]) => ({ value: String(id), label: name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [rows],
  );
  const stages = useMemo(
    () => [...new Set(rows.map((row) => row.stage))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const followups = useMemo(
    () => [...new Set(rows.flatMap((row) => row.followups))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  useEffect(() => {
    setProject(ALL);
    setStage(ALL);
    setVisit(ALL);
    setBlocked(ALL);
    setAttended(ALL);
    setLost(ALL);
    setHuman(ALL);
    setQualification(ALL);
    setFollowup(ALL);
    setPage(0);
  }, [activeEmpresaId]);
  useEffect(() => {
    setPage(0);
  }, [
    dateFrom,
    dateTo,
    project,
    stage,
    visit,
    blocked,
    attended,
    lost,
    human,
    qualification,
    followup,
    search,
  ]);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const term = search.trim().toLocaleLowerCase("pt-BR");
        if (project !== ALL && String(row.empreendimentoId) !== project) return false;
        if (stage !== ALL && row.stage !== stage) return false;
        if (visit !== ALL && row.visit !== visit) return false;
        if (blocked !== ALL && row.blocked !== (blocked === "yes")) return false;
        if (attended !== ALL && row.interactions > 0 !== (attended === "yes")) return false;
        if (lost !== ALL && row.lost !== (lost === "yes")) return false;
        if (human !== ALL && row.human !== (human === "yes")) return false;
        if (qualification !== ALL && row.qualification !== qualification) return false;
        if (
          followup !== ALL &&
          (followup === "none" ? row.followups.length > 0 : !row.followups.includes(followup))
        )
          return false;
        return (
          !term ||
          [row.nome, row.numero ?? "", row.crmId ?? "", String(row.id)].some((value) =>
            value.toLocaleLowerCase("pt-BR").includes(term),
          )
        );
      }),
    [rows, project, stage, visit, blocked, attended, lost, human, qualification, followup, search],
  );

  const metrics = {
    total: filtered.length,
    attended: filtered.filter((row) => row.interactions > 0).length,
    visits: filtered.filter((row) => row.visit === "active").length,
    blocked: filtered.filter((row) => row.blocked).length,
    human: filtered.filter((row) => row.human).length,
    qualified: filtered.filter((row) => row.qualification === "qualified").length,
    disqualified: filtered.filter((row) => row.qualification === "disqualified").length,
    followups: filtered.filter((row) => row.followups.length > 0).length,
    lost: filtered.filter((row) => row.lost).length,
  };
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (me && !canView)
    return (
      <div className="rounded-xl border bg-card p-8 text-muted-foreground">
        Relatório disponível para gestores, analistas e administradores.
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatório de Leads</h1>
          <p className="text-sm text-muted-foreground">
            Leads criados no sistema no período selecionado. Cada lead é contado uma vez.
          </p>
        </div>
        <Button variant="outline" disabled={!filtered.length} onClick={() => exportCsv(filtered)}>
          <Download className="mr-2 h-4 w-4" />
          Exportar CSV
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {isSuperAdmin && (
              <FilterSelect
                label="Empresa"
                value={activeEmpresaId ? String(activeEmpresaId) : ALL}
                onChange={(value) => {
                  if (value !== ALL) setActiveEmpresaId(Number(value));
                }}
                options={[
                  { value: ALL, label: "Selecione uma empresa" },
                  ...empresas.map((empresa) => ({
                    value: String(empresa.id),
                    label: empresa.nome ?? `Empresa ${empresa.id}`,
                  })),
                ]}
              />
            )}
            {!isSuperAdmin && (
              <div className="space-y-1 text-xs text-muted-foreground">
                <div>Empresa</div>
                <div className="flex h-9 items-center rounded-md border px-3 text-sm text-foreground">
                  {activeEmpresa?.nome ?? "—"}
                </div>
              </div>
            )}
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              <span>De (criação)</span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              <span>Até (criação)</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </label>
            <FilterSelect
              label="Empreendimento"
              value={project}
              onChange={setProject}
              options={[{ value: ALL, label: "Todos" }, ...projects]}
            />
            <FilterSelect
              label="Estado atual no sistema"
              value={stage}
              onChange={setStage}
              options={[
                { value: ALL, label: "Todos" },
                ...stages.map((value) => ({ value, label: value })),
              ]}
            />
            <FilterSelect
              label="Visita"
              value={visit}
              onChange={setVisit}
              options={[
                { value: ALL, label: "Todas" },
                { value: "active", label: "Agendamento registrado" },
                { value: "cancelled", label: "Agendamento cancelado" },
                { value: "none", label: "Sem agendamento" },
              ]}
            />
            <FilterSelect
              label="Bloqueio / telefone"
              value={blocked}
              onChange={setBlocked}
              options={[
                { value: ALL, label: "Todos" },
                { value: "yes", label: "Bloqueado ou sem telefone válido" },
                { value: "no", label: "Sem bloqueio identificado" },
              ]}
            />
            <FilterSelect
              label="Interação registrada"
              value={attended}
              onChange={setAttended}
              options={[
                { value: ALL, label: "Todos" },
                { value: "yes", label: "Com interação" },
                { value: "no", label: "Sem interação" },
              ]}
            />
            <FilterSelect
              label="Perdido no sistema"
              value={lost}
              onChange={setLost}
              options={[
                { value: ALL, label: "Todos" },
                { value: "yes", label: "Perdido" },
                { value: "no", label: "Não perdido" },
              ]}
            />
            <FilterSelect
              label="Atendimento humano"
              value={human}
              onChange={setHuman}
              options={[
                { value: ALL, label: "Todos" },
                { value: "yes", label: "Solicitado" },
                { value: "no", label: "Não solicitado" },
              ]}
            />
            <FilterSelect
              label="Qualificação"
              value={qualification}
              onChange={setQualification}
              options={[
                { value: ALL, label: "Todas" },
                { value: "qualified", label: "Qualificado" },
                { value: "disqualified", label: "Não qualificado" },
                { value: "pending", label: "Pendente" },
              ]}
            />
            <FilterSelect
              label="Follow-up registrado"
              value={followup}
              onChange={setFollowup}
              options={[
                { value: ALL, label: "Todos" },
                { value: "none", label: "Nenhum" },
                ...followups.map((value) => ({ value, label: value })),
              ]}
            />
          </div>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar nome, telefone ou ID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {dateFrom > dateTo && (
        <div className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">
          A data inicial deve ser anterior à data final.
        </div>
      )}
      {report.isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Carregando leads...
        </div>
      )}
      {report.error && (
        <div className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">
          Não foi possível carregar o relatório: {(report.error as Error).message}
        </div>
      )}
      {!report.isLoading && !report.error && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {[
              ["Leads criados", metrics.total],
              ["Com interação registrada", metrics.attended],
              ["Com agendamento registrado", metrics.visits],
              ["Bloqueados / telefone inválido", metrics.blocked],
              ["Atendimento humano", metrics.human],
              ["Qualificados", metrics.qualified],
              ["Não qualificados", metrics.disqualified],
              ["Com follow-up registrado", metrics.followups],
              ["Perdidos no sistema", metrics.lost],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-1 text-2xl font-semibold">
                    {Number(value).toLocaleString("pt-BR")}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            “Estado atual” usa o estágio interno, quando preenchido, ou o status operacional de{" "}
            <code>lead</code>. O estágio atual do CV externo não é sincronizado neste relatório.
            Agendamento registrado inclui datas passadas ainda não excluídas; atendimento significa
            pelo menos uma interação registrada em <code>lead.qtd_interacoes</code>.
          </p>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1150px] text-sm">
                  <thead className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                    <tr>
                      {[
                        "Lead",
                        "Criado em",
                        "Empreendimento",
                        "Estado atual",
                        "Interações",
                        "Qualificação",
                        "Visita",
                        "Humano",
                        "Bloqueio",
                        "Follow-ups",
                      ].map((title) => (
                        <th className="px-4 py-3 font-medium" key={title}>
                          {title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="px-4 py-3">
                          <div className="font-medium">{row.nome}</div>
                          <div className="text-xs text-muted-foreground">
                            ID {row.id}
                            {row.crmId ? ` · CV ${row.crmId}` : ""}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                        <td className="px-4 py-3">{row.empreendimento}</td>
                        <td className="px-4 py-3">{row.stage}</td>
                        <td className="px-4 py-3">{row.interactions}</td>
                        <td className="px-4 py-3">{qualificationLabel(row.qualification)}</td>
                        <td className="px-4 py-3">
                          <div>{visitLabel(row.visit)}</div>
                          {row.visitDays.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {row.visitDays.join(", ")}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">{row.human ? "Sim" : "Não"}</td>
                        <td className="px-4 py-3">{row.blockReason ?? "—"}</td>
                        <td className="px-4 py-3">{row.followups.join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!filtered.length && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Nenhum lead encontrado para os filtros selecionados.
                </div>
              )}
              {filtered.length > 0 && (
                <div className="flex items-center justify-between gap-3 border-t p-4 text-sm text-muted-foreground">
                  <span>
                    {filtered.length.toLocaleString("pt-BR")} leads · página {page + 1} de {pages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage((value) => value - 1)}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page + 1 >= pages}
                      onClick={() => setPage((value) => value + 1)}
                    >
                      Próxima
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

