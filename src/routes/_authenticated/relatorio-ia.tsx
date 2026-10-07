import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import {
  RelatorioAtendimento,
  type RelatorioLinha,
} from "@/components/relatorio-ia/relatorio-atendimento";

const searchSchema = z.object({
  inicio: fallback(z.string(), "").default(""),
  fim: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/relatorio-ia")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Relatório IA | Hub Katsuki.IA" },
      { name: "description", content: "Raio-X do atendimento da IA da sua empresa." },
      { property: "og:title", content: "Relatório IA | Hub Katsuki.IA" },
      { property: "og:description", content: "Raio-X do atendimento da IA da sua empresa." },
    ],
  }),
  component: RelatorioIaPage,
});

const FN_URL = "https://ksseilysiypcpartnari.supabase.co/functions/v1/relatorio-atendimento-hub";
const MIN_DATE = "2026-06-03";

class RelatorioError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function chamar<T>(query: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const res = await fetch(FN_URL + query, { headers: { Authorization: "Bearer " + token } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new RelatorioError(res.status, body?.erro ?? "Erro ao carregar relatório.");
  return body as T;
}

function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function addDias(iso: string, dias: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function formatBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatAtualizadoEm(valor?: string | null): string | null {
  if (!valor) return null;
  const d = new Date(valor);
  if (isNaN(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")} às ${get("hour")}:${get("minute")}`;
}

type Atalho = "7d" | "30d" | "mes" | "mes_passado" | "tudo" | "personalizado";

function periodoDeAtalho(atalho: Atalho, hoje: string): { inicio: string; fim: string } {
  switch (atalho) {
    case "7d":
      return { inicio: addDias(hoje, -6), fim: hoje };
    case "30d":
      return { inicio: addDias(hoje, -29), fim: hoje };
    case "mes":
      return { inicio: hoje.slice(0, 8) + "01", fim: hoje };
    case "mes_passado": {
      const d = new Date(hoje + "T12:00:00");
      const primeiro = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const ultimo = new Date(d.getFullYear(), d.getMonth(), 0);
      return {
        inicio: primeiro.toISOString().slice(0, 10),
        fim: ultimo.toISOString().slice(0, 10),
      };
    }
    case "tudo":
      return { inicio: MIN_DATE, fim: hoje };
    default:
      return { inicio: MIN_DATE, fim: hoje };
  }
}

function RelatorioIaPage() {
  const { data: me, isLoading: loadingMe } = useCrmUser();
  const { activeEmpresaId } = useActiveEmpresa();
  const isSuper = me?.role === "super_admin";
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const hoje = useMemo(() => hojeSP(), []);

  const [atalho, setAtalho] = useState<Atalho>("30d");

  const periodoPadrao = useMemo(() => periodoDeAtalho("30d", hoje), [hoje]);
  const inicio = search.inicio || periodoPadrao.inicio;
  const fim = search.fim || periodoPadrao.fim;

  const aplicarAtalho = (novo: Atalho) => {
    setAtalho(novo);
    if (novo !== "personalizado") {
      const p = periodoDeAtalho(novo, hoje);
      navigate({ search: { inicio: p.inicio, fim: p.fim }, replace: true });
    }
  };

  const aplicarPersonalizado = (campo: "inicio" | "fim", valor: string) => {
    if (!valor) return;
    const clamped = valor < MIN_DATE ? MIN_DATE : valor > hoje ? hoje : valor;
    navigate({
      search: { inicio: campo === "inicio" ? clamped : inicio, fim: campo === "fim" ? clamped : fim },
      replace: true,
    });
  };

  const semEmpresa = isSuper && !activeEmpresaId;

  const relatorio = useQuery({
    queryKey: ["relatorio-ia", isSuper ? activeEmpresaId : "self", inicio, fim],
    queryFn: () => {
      const params = new URLSearchParams();
      if (isSuper && activeEmpresaId) params.set("id_empresa", String(activeEmpresaId));
      params.set("inicio", inicio);
      params.set("fim", fim);
      return chamar<{
        cliente: RelatorioLinha & { atualizado_em?: string | null };
        carteira: RelatorioLinha | null;
      }>("?" + params.toString());
    },
    enabled: !!me && !semEmpresa,
    retry: false,
  });

  const err = relatorio.error as RelatorioError | null;
  const msg = err
    ? err.status === 401 || err.status === 403
      ? "Sem acesso ao relatório."
      : err.status === 404
        ? "Relatório ainda não disponível para esta empresa"
        : err.message
    : null;

  const atualizadoEm = formatAtualizadoEm(relatorio.data?.cliente?.atualizado_em);

  const atalhos: { id: Atalho; label: string }[] = [
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
        {atalhos.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => aplicarAtalho(a.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              atalho === a.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {a.label}
          </button>
        ))}
        {atalho === "personalizado" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={inicio}
              min={MIN_DATE}
              max={hoje}
              onChange={(e) => aplicarPersonalizado("inicio", e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
            <span className="text-xs text-muted-foreground">até</span>
            <input
              type="date"
              value={fim}
              min={MIN_DATE}
              max={hoje}
              onChange={(e) => aplicarPersonalizado("fim", e.target.value)}
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
      ) : msg ? (
        <p className="py-20 text-center text-sm text-muted-foreground">{msg}</p>
      ) : relatorio.data ? (
        <RelatorioAtendimento cliente={relatorio.data.cliente} carteira={relatorio.data.carteira} />
      ) : null}
    </div>
  );
}
