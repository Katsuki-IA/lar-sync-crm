import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, type ReactNode } from "react";
import { Download, Info } from "lucide-react";

import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { useCrmUser } from "@/hooks/use-crm-user";
import { getLeadReport, type LeadReportRow } from "@/lib/lead-report.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/relatorio-leads")({
  head: () => ({
    meta: [
      { title: "Relatório de Leads | Katsuki.IA" },
      { name: "description", content: "Relatório detalhado de leads por empresa e período." },
      { property: "og:title", content: "Relatório de Leads | Katsuki.IA" },
      { property: "og:description", content: "Relatório detalhado de leads por empresa e período." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeadReportPage,
});

const PAGE = 50;
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const monthStart = () => `${today().slice(0, 8)}01`;
const qualLabel = (q: number) => (q === 1 ? "Qualificado" : q === 2 ? "Não qualificado" : "Pendente");
const visitLabel = { registrada: "Registrada", cancelada: "Cancelada", sem: "Sem agendamento" };
const fmtDate = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

function LeadReportPage() {
  const { data: me } = useCrmUser();
  const { activeEmpresaId, empresas, isSuperAdmin, setActiveEmpresaId } = useActiveEmpresa();
  const fetchReport = useServerFn(getLeadReport);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [emp, setEmp] = useState("all");
  const [f, setF] = useState({ estado: "all", visita: "all", bloqueio: "all", interacao: "all", humano: "all", qual: "all", fup: "all", perdido: "all" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const allowedRole = me && ["manager", "analyst", "super_admin"].includes(me.role);
  const q = useQuery({
    enabled: !!activeEmpresaId && !!allowedRole && !!from && !!to,
    queryKey: ["lead-report", activeEmpresaId, emp, from, to],
    queryFn: () =>
      fetchReport({ data: { empresaId: activeEmpresaId!, empreendimentoId: emp === "all" ? null : Number(emp), from, to } }),
  });
  const rows = q.data?.rows ?? [];
  const estados = useMemo(() => [...new Set(rows.map((r) => r.estado))].sort(), [rows]);
  const fups = useMemo(() => [...new Set(rows.flatMap((r) => r.followups))].sort(), [rows]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const sd = s.replace(/\D/g, "");
    return rows.filter((r) => {
      if (f.estado !== "all" && r.estado !== f.estado) return false;
      if (f.visita !== "all" && r.visita !== f.visita) return false;
      if (f.bloqueio === "bloqueado" && !r.bloqueado) return false;
      if (f.bloqueio === "invalido" && r.telefoneValido) return false;
      if (f.bloqueio === "ok" && (r.bloqueado || !r.telefoneValido)) return false;
      if (f.interacao === "com" && r.interacoes <= 0) return false;
      if (f.interacao === "sem" && r.interacoes > 0) return false;
      if (f.humano !== "all" && r.humano !== (f.humano === "sim")) return false;
      if (f.qual !== "all" && r.qualificado !== Number(f.qual)) return false;
      if (f.fup === "none" && r.followups.length) return false;
      if (f.fup !== "all" && f.fup !== "none" && !r.followups.includes(f.fup)) return false;
      if (f.perdido !== "all" && r.perdido !== (f.perdido === "sim")) return false;
      if (s) {
        const hit = (r.nome ?? "").toLowerCase().includes(s) || String(r.id) === s || (r.idExterno ?? "").toLowerCase() === s || (sd.length >= 4 && (r.numero ?? "").replace(/\D/g, "").includes(sd));
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, f, search]);

  const k = {
    total: filtered.length,
    interacao: filtered.filter((r) => r.interacoes > 0).length,
    qualificados: filtered.filter((r) => r.qualificado === 1).length,
    visitas: filtered.filter((r) => r.visita === "registrada").length,
    humano: filtered.filter((r) => r.humano).length,
    bloqueados: filtered.filter((r) => r.bloqueado || !r.telefoneValido).length,
    fup: filtered.filter((r) => r.followups.length).length,
    perdidos: filtered.filter((r) => r.perdido).length,
  };
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const pageRows = filtered.slice(cur * PAGE, cur * PAGE + PAGE);
  const set = (key: keyof typeof f) => (v: string) => { setF((p) => ({ ...p, [key]: v })); setPage(0); };

  function exportCsv() {
    const head = ["id", "id_externo", "nome", "telefone", "criado_em", "empreendimento", "estado", "interacoes", "qualificacao", "visita", "datas_visita", "atendimento_humano", "bloqueado", "telefone_valido", "motivo_bloqueio", "followups", "perdido"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = filtered.map((r: LeadReportRow) =>
      [r.id, r.idExterno, r.nome, r.numero, fmtDate(r.createdAt), r.empreendimento, r.estado, r.interacoes, qualLabel(r.qualificado), visitLabel[r.visita], r.visitaDatas.join(" "), r.humano ? "sim" : "não", r.bloqueado ? "sim" : "não", r.telefoneValido ? "sim" : "não", r.motivoBloqueio, r.followups.join(" "), r.perdido ? "sim" : "não"].map(esc).join(";"),
    );
    const blob = new Blob(["\uFEFF" + [head.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `relatorio-leads-${from}-a-${to}.csv`;
    a.click();
  }

  if (me && !allowedRole) return <p className="text-muted-foreground">Sem acesso a este relatório.</p>;

  const sel = (label: string, value: string, onChange: (v: string) => void, opts: [string, string][]) => (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{opts.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatório de Leads</h1>
          <p className="text-sm text-muted-foreground">Leads criados no período (horário de Brasília), um por linha.</p>
        </div>
        <Button onClick={exportCsv} disabled={!filtered.length}><Download className="mr-2 h-4 w-4" />Exportar CSV</Button>
      </div>

      <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0" />
        <span>O estágio atual no CRM externo (CV) não é sincronizado — o estado mostrado é o do Hub. Agendamentos não excluídos contam como visita registrada, inclusive com datas já passadas.</span>
      </div>

      <Card><CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-4">
        {isSuperAdmin
          ? sel("Empresa", activeEmpresaId ? String(activeEmpresaId) : "", (v) => { setActiveEmpresaId(Number(v)); setEmp("all"); setPage(0); }, empresas.map((e) => [String(e.id), e.nome ?? `#${e.id}`]))
          : <Field label="Empresa"><Input value={empresas.find((e) => e.id === activeEmpresaId)?.nome ?? ""} disabled /></Field>}
        {sel("Empreendimento", emp, (v) => { setEmp(v); setPage(0); }, [["all", "Todos"], ...(q.data?.empreendimentos ?? []).map((e): [string, string] => [String(e.id), e.nome ?? `#${e.id}`])])}
        <Field label="Criado de"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /></Field>
        <Field label="Criado até"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} /></Field>
        {sel("Estado atual", f.estado, set("estado"), [["all", "Todos"], ...estados.map((e): [string, string] => [e, e])])}
        {sel("Visita", f.visita, set("visita"), [["all", "Todas"], ["registrada", "Registrada"], ["cancelada", "Cancelada"], ["sem", "Sem agendamento"]])}
        {sel("Bloqueio / telefone", f.bloqueio, set("bloqueio"), [["all", "Todos"], ["bloqueado", "Bloqueado"], ["invalido", "Sem telefone válido"], ["ok", "Sem restrição"]])}
        {sel("Interação", f.interacao, set("interacao"), [["all", "Todos"], ["com", "Com interação"], ["sem", "Sem interação"]])}
        {sel("Atendimento humano", f.humano, set("humano"), [["all", "Todos"], ["sim", "Sim"], ["nao", "Não"]])}
        {sel("Qualificação", f.qual, set("qual"), [["all", "Todas"], ["0", "Pendente"], ["1", "Qualificado"], ["2", "Não qualificado"]])}
        {sel("Follow-up", f.fup, set("fup"), [["all", "Todos"], ["none", "Nenhum"], ...fups.map((x): [string, string] => [x, x])])}
        {sel("Perdido", f.perdido, set("perdido"), [["all", "Todos"], ["sim", "Sim"], ["nao", "Não"]])}
        <div className="sm:col-span-2 lg:col-span-4"><Field label="Buscar"><Input placeholder="Nome, telefone ou ID" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></Field></div>
      </CardContent></Card>

      <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {[["Leads", k.total], ["Com interação", k.interacao], ["Qualificados", k.qualificados], ["Visita registrada", k.visitas], ["Humano", k.humano], ["Bloq./inválido", k.bloqueados], ["Com follow-up", k.fup], ["Perdidos", k.perdidos]].map(([l, v]) => (
          <Card key={l}><CardContent className="pt-4"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-semibold">{v}</div></CardContent></Card>
        ))}
      </div>

      <Card><CardContent className="overflow-x-auto p-0">
        {q.isLoading ? <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
          : q.error ? <p className="p-6 text-sm text-destructive">{(q.error as Error).message}</p>
          : !activeEmpresaId ? <p className="p-6 text-sm text-muted-foreground">Escolha uma empresa.</p>
          : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>{["ID / Externo", "Nome", "Criado em", "Empreendimento", "Estado", "Interações", "Qualificação", "Visita", "Humano", "Bloqueio", "Follow-ups"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap">#{r.id}<div className="text-xs text-muted-foreground">{r.idExterno ?? "—"}</div></td>
                  <td className="px-3 py-2">{r.nome ?? "—"}<div className="text-xs text-muted-foreground">{r.numero}</div></td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                  <td className="px-3 py-2">{r.empreendimento ?? "—"}</td>
                  <td className="px-3 py-2">{r.estado}{r.perdido && <div className="text-xs text-destructive">Perdido</div>}</td>
                  <td className="px-3 py-2">{r.interacoes}</td>
                  <td className="px-3 py-2">{qualLabel(r.qualificado)}</td>
                  <td className="px-3 py-2">{visitLabel[r.visita]}<div className="text-xs text-muted-foreground">{r.visitaDatas.join(", ")}</div></td>
                  <td className="px-3 py-2">{r.humano ? "Sim" : "Não"}</td>
                  <td className="px-3 py-2 text-xs">{r.motivoBloqueio ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.followups.join(", ") || "—"}</td>
                </tr>
              ))}
              {!pageRows.length && <tr><td colSpan={11} className="p-6 text-center text-muted-foreground">Nenhum lead encontrado.</td></tr>}
            </tbody>
          </table>
        )}
      </CardContent></Card>

      <div className="flex items-center justify-end gap-2 text-sm">
        <span className="text-muted-foreground">Página {cur + 1} de {pages}</span>
        <Button variant="outline" size="sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Anterior</Button>
        <Button variant="outline" size="sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Próxima</Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="space-y-1 text-xs font-medium text-muted-foreground"><span>{label}</span>{children}</label>;
}
