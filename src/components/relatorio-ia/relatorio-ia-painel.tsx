import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { useCrmUser } from "@/hooks/use-crm-user";
import { supabase } from "@/integrations/supabase/client";
import {
  RelatorioAtendimento,
  RelatorioComportamento,
  type RelatorioLinha,
} from "@/components/relatorio-ia/relatorio-atendimento";

const FN_URL = "https://ksseilysiypcpartnari.supabase.co/functions/v1/relatorio-atendimento-hub";
const MIN_DATE = "2026-06-03";

type Atalho = "7d" | "30d" | "mes" | "mes_passado" | "tudo" | "personalizado";
type RelatorioTipo = "raio-x" | "comportamento";

type RelatorioIaPainelProps = {
  tipo: RelatorioTipo;
  inicioParam: string;
  fimParam: string;
  onPeriodoChange: (inicio: string, fim: string) => void;
};

class RelatorioError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function chamar<T>(query: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const response = await fetch(FN_URL + query, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new RelatorioError(response.status, body?.erro ?? "Erro ao carregar relatório.");
  }
  return body as T;
}

function hojeSP() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function addDias(iso: string, dias: number) {
  const data = new Date(`${iso}T12:00:00`);
  data.setDate(data.getDate() + dias);
  return data.toISOString().slice(0, 10);
}

function formatBR(iso: string) {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function formatAtualizadoEm(valor?: string | null) {
  if (!valor) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(data);
  const get = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${get("day")}/${get("month")} às ${get("hour")}:${get("minute")}`;
}

function periodoDeAtalho(atalho: Atalho, hoje: string) {
  if (atalho === "7d") return { inicio: addDias(hoje, -6), fim: hoje };
  if (atalho === "30d") return { inicio: addDias(hoje, -29), fim: hoje };
  if (atalho === "mes") return { inicio: `${hoje.slice(0, 8)}01`, fim: hoje };
  if (atalho === "mes_passado") {
    const data = new Date(`${hoje}T12:00:00`);
    return {
      inicio: new Date(data.getFullYear(), data.getMonth() - 1, 1).toISOString().slice(0, 10),
      fim: new Date(data.getFullYear(), data.getMonth(), 0).toISOString().slice(0, 10),
    };
  }
  return { inicio: MIN_DATE, fim: hoje };
}

export function RelatorioIaPainel({
  tipo,
  inicioParam,
  fimParam,
  onPeriodoChange,
}: RelatorioIaPainelProps) {
  const { data: me, isLoading: loadingMe } = useCrmUser();
  const { activeEmpresaId } = useActiveEmpresa();
  const enviaEmpresa = me?.role === "super_admin" || me?.role === "analyst";
  const hoje = useMemo(hojeSP, []);
  const periodoPadrao = useMemo(() => periodoDeAtalho("30d", hoje), [hoje]);
  const inicio = inicioParam || periodoPadrao.inicio;
  const fim = fimParam || periodoPadrao.fim;
  const [atalho, setAtalho] = useState<Atalho>("30d");
  const semEmpresa = enviaEmpresa && !activeEmpresaId;

  const relatorio = useQuery({
    queryKey: ["relatorio-ia", enviaEmpresa ? activeEmpresaId : "self", inicio, fim],
    queryFn: () => {
      const params = new URLSearchParams({ inicio, fim });
      if (enviaEmpresa && activeEmpresaId) params.set("id_empresa", String(activeEmpresaId));
      return chamar<{
        cliente: RelatorioLinha & { atualizado_em?: string | null };
        carteira: RelatorioLinha | null;
      }>(`?${params.toString()}`);
    },
    enabled: Boolean(me) && !semEmpresa,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const aplicarAtalho = (novo: Atalho) => {
    setAtalho(novo);
    if (novo !== "personalizado") {
      const periodo = periodoDeAtalho(novo, hoje);
      onPeriodoChange(periodo.inicio, periodo.fim);
    }
  };

  const aplicarPersonalizado = (campo: "inicio" | "fim", valor: string) => {
    if (!valor) return;
    const ajustado = valor < MIN_DATE ? MIN_DATE : valor > hoje ? hoje : valor;
    onPeriodoChange(campo === "inicio" ? ajustado : inicio, campo === "fim" ? ajustado : fim);
  };

  const erro = relatorio.error as RelatorioError | null;
  const mensagem = erro
    ? erro.status === 401 || erro.status === 403
      ? "Sem acesso ao relatório."
      : erro.status === 404
        ? "Relatório ainda não disponível para esta empresa"
        : erro.message
    : null;
  const atualizadoEm = formatAtualizadoEm(relatorio.data?.cliente.atualizado_em);
  const atalhos: Array<{ id: Atalho; label: string }> = [
    { id: "7d", label: "Últimos 7 dias" },
    { id: "30d", label: "Últimos 30 dias" },
    { id: "mes", label: "Este mês" },
    { id: "mes_passado", label: "Mês passado" },
    { id: "tudo", label: "Todo o período" },
    { id: "personalizado", label: "Personalizado" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {atalhos.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={atalho === item.id ? "default" : "outline"}
            className="h-8 rounded-full px-3 text-xs"
            onClick={() => aplicarAtalho(item.id)}
          >
            {item.label}
          </Button>
        ))}
        {atalho === "personalizado" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={inicio}
              min={MIN_DATE}
              max={hoje}
              onChange={(event) => aplicarPersonalizado("inicio", event.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
            <span className="text-xs text-muted-foreground">até</span>
            <input
              type="date"
              value={fim}
              min={MIN_DATE}
              max={hoje}
              onChange={(event) => aplicarPersonalizado("fim", event.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
          </div>
        )}
        <span className="text-xs text-muted-foreground">
          Leads que entraram no período ({formatBR(inicio)} a {formatBR(fim)}).
          {atualizadoEm ? ` Dados atualizados em ${atualizadoEm}` : ""}
        </span>
      </div>

      {loadingMe || relatorio.isLoading ? (
        <p className="py-20 text-center text-sm text-muted-foreground">Carregando relatório…</p>
      ) : semEmpresa ? (
        <p className="py-20 text-center text-sm text-muted-foreground">
          Selecione uma empresa no topo da página
        </p>
      ) : mensagem ? (
        <p className="py-20 text-center text-sm text-muted-foreground">{mensagem}</p>
      ) : relatorio.data ? (
        tipo === "raio-x" ? (
          <RelatorioAtendimento
            cliente={relatorio.data.cliente}
            carteira={relatorio.data.carteira}
          />
        ) : (
          <RelatorioComportamento
            cliente={relatorio.data.cliente}
            carteira={relatorio.data.carteira}
          />
        )
      ) : null}
    </div>
  );
}
