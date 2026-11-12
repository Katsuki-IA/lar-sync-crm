import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getAiCosts, type CostRow } from "@/lib/ai-costs.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/custos-ia")({ component: AiCostsPage });
const number = (n: number | null) => (n === null ? "—" : new Intl.NumberFormat("pt-BR").format(n));
const usd = (n: number | null) =>
  n === null
    ? "Não calculado"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 4,
        maximumFractionDigits: 6,
      }).format(n);
function csv(rows: CostRow[], month: string) {
  const cells = [
    [
      "Empresa",
      "Provedor",
      "Ambiente",
      "Chamadas observadas",
      "Com tokens",
      "Com preço",
      "Entrada",
      "Saída",
      "Cache conhecido",
      "USD mínimo calculado",
      "USD máximo calculado",
    ],
    ...rows.map((r) => [
      r.company,
      r.provider,
      r.environment,
      r.calls,
      r.measured_calls,
      r.priced_calls,
      r.input_tokens,
      r.output_tokens,
      r.cached_tokens,
      r.cost_min_usd,
      r.cost_max_usd,
    ]),
  ];
  const quote = (v: unknown) =>
    `"${String(v ?? "")
      .replace(/^[=+@\-]/, "'$&")
      .replace(/"/g, '""')}"`;
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + cells.map((row) => row.map(quote).join(";")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `custos-ia-${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
function AiCostsPage() {
  const [month, setMonth] = useState(() =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
    }).format(new Date()),
  );
  const [company, setCompany] = useState("all");
  const [provider, setProvider] = useState("all");
  const fn = useServerFn(getAiCosts);
  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: ["ai-costs", month],
    queryFn: () => fn({ data: { month } }),
    enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(month),
  });
  const rows = (data?.rows ?? []).filter(
    (r) =>
      (company === "all" || String(r.id_empresa) === company) &&
      (provider === "all" || r.provider === provider),
  );
  const calls = rows.reduce((s, r) => s + r.calls, 0),
    measured = rows.reduce((s, r) => s + r.measured_calls, 0),
    priced = rows.reduce((s, r) => s + r.priced_calls, 0);
  const companies = [
    ...new Map((data?.rows ?? []).map((r) => [String(r.id_empresa), r.company])).entries(),
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold mr-auto">Custos de IA</h2>
        <Input
          aria-label="Mês do consumo"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="w-44"
        />
        <Button variant="outline" disabled={isFetching} onClick={() => refetch()}>
          Atualizar
        </Button>
        <Button disabled={!rows.length} onClick={() => csv(rows, month)}>
          Exportar CSV
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Consumo observado por empresa, em USD. Período mensal no fuso de São Paulo. Custos
        calculados não são a fatura do provedor.
      </p>
      <div className="flex flex-wrap gap-3">
        <select
          aria-label="Empresa"
          className="border rounded p-2 bg-background"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        >
          <option value="all">Todas as empresas</option>
          {companies.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Provedor"
          className="border rounded p-2 bg-background"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          <option value="all">Todos os provedores</option>
          <option value="openai">OpenAI</option>
          <option value="deepseek">DeepSeek</option>
        </select>
      </div>
      {error ? (
        <Card className="p-4 text-destructive" role="alert">
          Falha ao carregar o relatório. Tente atualizar.
        </Card>
      ) : isPending ? (
        <p>Carregando custos…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              Chamadas observadas<strong className="block text-2xl">{number(calls)}</strong>
            </Card>
            <Card className="p-4">
              Com tokens registrados
              <strong className="block text-2xl">
                {number(measured)} / {number(calls)}
              </strong>
            </Card>
            <Card className="p-4">
              Com custo calculável
              <strong className="block text-2xl">
                {number(priced)} / {number(calls)}
              </strong>
            </Card>
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  {[
                    "Empresa",
                    "Provedor",
                    "Ambiente",
                    "Chamadas",
                    "Entrada / saída",
                    "Com custo",
                    "Custo calculado USD",
                  ].map((h) => (
                    <th key={h} className="p-3 text-left whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.id_empresa}-${r.provider}-${r.environment}`} className="border-b">
                    <td className="p-3">{r.company}</td>
                    <td className="p-3">{r.provider}</td>
                    <td className="p-3">{r.environment === "test" ? "Teste" : "Produção"}</td>
                    <td className="p-3">{number(r.calls)}</td>
                    <td className="p-3 whitespace-nowrap">
                      {number(r.input_tokens)} / {number(r.output_tokens)}
                    </td>
                    <td className="p-3">
                      {r.priced_calls}/{r.calls}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {r.cost_min_usd === r.cost_max_usd
                        ? usd(r.cost_max_usd)
                        : `${usd(r.cost_min_usd)} a ${usd(r.cost_max_usd)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <p className="p-5 text-muted-foreground">
                Nenhum consumo registrado neste período e filtro. Isso não significa custo zero.
              </p>
            )}
          </Card>
          <p className="text-sm text-muted-foreground">
            {number(rows.reduce((s, r) => s + (r.estimated_calls ?? 0), 0))} chamadas usam
            estimativas de tokens do n8n e não medições do provedor. Os totais de tokens e custos
            incluem essas estimativas. Quando o cache não está disponível, o intervalo considera os
            extremos com e sem desconto de cache; ele não limita o erro das estimativas de tokens.
            Áudio, chamadas sem tokens, modelos sem tarifa e tentativas internas não expostas pelo
            provedor podem ficar fora do cálculo. Chamadas de teste estão identificadas. Não é feito
            rateio entre empresas.
          </p>
          <Card className="p-4 space-y-2">
            <h3 className="font-medium">Totais importados dos provedores</h3>
            {!data?.provider_costs.length ? (
              <p className="text-sm text-muted-foreground">
                Nenhum arquivo de custos importado para este período.
              </p>
            ) : (
              data.provider_costs.map((p) => (
                <div
                  key={`${p.provider}-${p.period_start}-${p.scope}`}
                  className="text-sm border-t pt-2"
                >
                  <strong>
                    {p.provider}: {usd(p.amount_usd)}
                  </strong>
                  <p>
                    {p.scope} · {p.period_start} até {p.period_end} (fim exclusivo)
                  </p>
                  <p className="text-muted-foreground">Fonte: {p.source_file}</p>
                </div>
              ))
            )}
            <p className="text-sm text-muted-foreground">
              O escopo e o fuso das exportações podem diferir dos dados do CRM. Estes totais não são
              distribuídos automaticamente entre empresas.
            </p>
          </Card>
          <details className="border rounded p-4">
            <summary className="cursor-pointer font-medium">
              Saúde da coleta e fontes monitoradas
            </summary>
            <p className="my-3 text-sm">
              Pendências: {number(data?.queue.pending ?? 0)} · Execuções indisponíveis:{" "}
              {number(data?.queue.unavailable ?? 0)} · Última gravação:{" "}
              {data?.queue.last_collected_at
                ? new Date(data.queue.last_collected_at).toLocaleString("pt-BR")
                : "Ainda sem coleta"}
            </p>
            <ul className="space-y-1 text-sm">
              {data?.sources.map((s) => (
                <li key={s.workflow_id}>
                  {s.name} — {s.enabled ? "Monitorado" : "Pausado"} · Última verificação:{" "}
                  {s.last_scan_at ? new Date(s.last_scan_at).toLocaleString("pt-BR") : "Pendente"}
                </li>
              ))}
            </ul>
          </details>
          <details className="border rounded p-4">
            <summary className="cursor-pointer font-medium">Tarifas usadas no cálculo</summary>
            <div className="space-y-2 pt-3">
              {data?.rates.map((r) => (
                <p key={`${r.provider}-${r.model}-${r.valid_from}`} className="text-sm">
                  {r.provider} / {r.model}: entrada {usd(r.input_usd_per_million)}, cache{" "}
                  {usd(r.cached_usd_per_million)}, saída {usd(r.output_usd_per_million)} por milhão
                  de tokens. Vigência: {r.valid_from}.{" "}
                  <a className="underline" href={r.source_url} target="_blank" rel="noreferrer">
                    Fonte
                  </a>
                </p>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
