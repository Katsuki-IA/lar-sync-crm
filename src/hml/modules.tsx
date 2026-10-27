import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { useCrmUser } from "@/hooks/use-crm-user";
import { buttonVariants } from "@/components/ui/button";
import {
  LayoutDashboard,
  UsersRound,
  Bot,
  BriefcaseBusiness,
  Building2,
  Settings2,
  FlaskConical,
  CheckSquare2,
  ListOrdered,
  MessagesSquare,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import "./visual.css";
import { companyApi, type CompanyModules } from "./company-api";

// New schema is isolated in HML. Do not replace the production generated types.
export const db = supabase as unknown as SupabaseClient;
export type Modules = CompanyModules;
export type Funnel = {
  id: number;
  id_empresa: number;
  nome: string;
  module: "ia" | "crm";
  is_default: boolean;
};
export type Stage = { id: number; id_funnel: number; nome: string; cor: string; ordem: number };
export type Opportunity = {
  id: string;
  id_empresa: number;
  lead_id: number;
  funnel_id: number;
  stage_id: number;
  title: string;
  assigned_to: string | null;
  version: number;
  updated_at: string;
};
export type Contact = {
  id: number;
  nome: string;
  telefone: string;
  email: string | null;
  crm_stage_id: number | null;
  crm_assigned_to: string | null;
};
export type Member = { id: string; nome: string; role: string; active?: boolean | null };
export const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-60";
export const actionClass = buttonVariants();
export const secondaryClass = buttonVariants({ variant: "outline" });
export function one<T>(data: T | T[]): T {
  return Array.isArray(data) ? data[0] : data;
}
export function useCompanyModules(companyId?: number | null) {
  const { activeEmpresaId } = useActiveEmpresa();
  const targetCompanyId = companyId === undefined ? activeEmpresaId : companyId;
  const { data: me } = useCrmUser();
  return useQuery({
    queryKey: ["company-modules", targetCompanyId, me?.id],
    enabled: !!targetCompanyId && !!me,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      return companyApi(db).modules(targetCompanyId!);
    },
  });
}
export function ModuleBoundary({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { activeEmpresaId } = useActiveEmpresa();
  const { data: me } = useCrmUser();
  const modules = useCompanyModules();
  if (me && !me.active)
    return (
      <Notice title="Acesso suspenso">
        Seu acesso aos dados desta empresa está suspenso. Entre em contato com a administração
        Katsuki.
      </Notice>
    );
  if (me?.role === 'analyst') return ['/dashboard','/relatorios','/relatorio-leads','/analise-conversas'].includes(pathname) ? children : <Notice title="Acesso restrito">Seu perfil permite consultar relatórios das empresas autorizadas.</Notice>;
  if (pathname === "/modulos")
    return me?.role === "super_admin" ? (
      children
    ) : (
      <Notice title="Acesso restrito">
        A configuração dos módulos é feita pelo administrador.
      </Notice>
    );
  if (!activeEmpresaId)
    return <Notice title="Selecione uma empresa">Use o seletor no topo para começar.</Notice>;
  if (["/administracao", "/configuracoes"].includes(pathname))
    return ["super_admin", "manager"].includes(me?.role ?? "") ? (
      children
    ) : (
      <Notice title="Acesso restrito">Área destinada à administração e aos gestores.</Notice>
    );
  if (modules.isPending)
    return <p className="p-6 text-sm text-muted-foreground">Carregando módulos da empresa…</p>;
  if (modules.isError)
    return (
      <Notice title="Não foi possível verificar o acesso">
        <button className={secondaryClass} onClick={() => modules.refetch()}>
          Tentar novamente
        </button>
      </Notice>
    );
  const requiresIA =
    pathname === "/kanban" || pathname === "/leads/new" || pathname === "/conversas";
  if (
    (requiresIA && !modules.data.atendimento_ia) ||
    (["/crm", "/tarefas", "/filas", "/configuracoes/secretaria"].includes(pathname) && !modules.data.crm)
  )
    return (
      <Notice title="Módulo não habilitado para esta empresa">
        <p className="mb-4">
          {pathname === "/leads/new"
            ? "Cadastre leads e oportunidades pelo CRM comercial."
            : "Escolha um dos módulos disponíveis no menu."}
        </p>
        <Link className={secondaryClass} to={modules.data.crm ? "/crm" : "/kanban"}>
          {modules.data.crm ? "Abrir CRM comercial" : "Abrir Atendimento IA"}
        </Link>
      </Notice>
    );
  return children;
}
export function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white p-8">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
export function IAOnly({ children }: { children: ReactNode }) {
  const { data: modules } = useCompanyModules();
  return modules?.atendimento_ia ? <>{children}</> : null;
}
export function AppSidebar({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void } = {}) {
  const { data: modules } = useCompanyModules();
  const { data: me } = useCrmUser();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const icons: Record<string, LucideIcon> = {
    "/dashboard": LayoutDashboard,
    "/leads": UsersRound,
    "/kanban": Bot,
    "/conversas": MessagesSquare,
    "/relatorios": BarChart3,
    "/relatorio-leads": BarChart3,
    "/analise-conversas": BarChart3,
    "/crm": BriefcaseBusiness,
    "/tarefas": CheckSquare2,
    "/filas": ListOrdered,
    "/modulos": Building2,
    "/administracao": Settings2,
    "/configuracoes": Settings2,
  };
  const items = [
    ["/dashboard", "Visão geral"],
    ...(me?.role !== 'analyst' ? [["/leads", "Leads"]] : []),
    ["/analise-conversas", "Análise de Funil"],
    ["/relatorio-leads", "Relatório de Leads"],
    ["/relatorios", "Relatórios"],
    ...(modules?.atendimento_ia && me?.role !== 'analyst'
      ? [
          ["/kanban", "Atendimento IA"],
          ["/conversas", "Conversas"],
        ]
      : []),
    ...(modules?.crm && me?.role !== 'analyst'
      ? [
          ["/crm", "CRM comercial"],
          ["/tarefas", "Tarefas"],
          ["/filas", me?.role === "agent" ? "Minhas ofertas" : "Filas de distribuição"],
        ]
      : []),
    ...(me?.role === "super_admin" ? [["/modulos", "Empresas e módulos"]] : []),
    ...(["super_admin", "manager"].includes(me?.role ?? "")
      ? [["/configuracoes", "Configurações"], ["/administracao", me?.role === "super_admin" ? "Administração" : "Minha empresa"]]
      : []),
  ];
  return (
    <aside className={`hml-sidebar ${mobile ? "hml-sidebar-mobile" : "hml-sidebar-desktop"}`}>
      <Link to="/dashboard" onClick={onNavigate} className="hml-brand" aria-label="Katsuki HUB — Visão geral">
        <img src="/katsuki-hub-laranja.png" alt="Katsuki HUB" width="2172" height="724" />
      </Link>
      <div className="hml-nav-caption">Área de trabalho</div>
      <nav className="hml-navigation" aria-label="Navegação principal">
        {items.map(([to, label]) => {
          const Icon = icons[to];
          const active = path === to || (to === "/leads" && path.startsWith("/leads/"));
          return (
            <Link
              key={to}
              to={to as "/dashboard"}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className="hml-nav-link"
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="hml-sidebar-footer">
        <FlaskConical size={15} aria-hidden="true" />
        <div>
          <strong>Homologação</strong>
          <p>Dados controlados · Envios apenas de teste</p>
        </div>
      </div>
    </aside>
  );
}
export function LeadModuleContexts({ leadId }: { leadId: number }) {
  const { activeEmpresaId } = useActiveEmpresa();
  const { data: modules } = useCompanyModules();
  const query = useQuery({
    queryKey: ["lead-opportunities", activeEmpresaId, leadId],
    enabled: !!activeEmpresaId && !!modules?.crm,
    queryFn: async () => {
      const [opps, stages] = await Promise.all([
        db
          .from("crm_opportunities")
          .select("id,title,stage_id,assigned_to")
          .eq("id_empresa", activeEmpresaId!)
          .eq("lead_id", leadId),
        db
          .from("crm_stages")
          .select("id,nome")
          .eq("id_empresa", activeEmpresaId!)
          .eq("module", "crm"),
      ]);
      if (opps.error) throw opps.error;
      if (stages.error) throw stages.error;
      return { opps: opps.data, stages: stages.data };
    },
  });
  return (
    <section className="rounded-xl border bg-white p-4 text-sm">
      <div className="mb-2 font-semibold">Contextos deste lead</div>
      <p className="text-muted-foreground">
        {modules?.atendimento_ia
          ? "O estágio de atendimento abaixo pertence à IA."
          : "Esta empresa opera sem Atendimento IA."}
      </p>
      {modules?.crm && (
        <div className="mt-3">
          <span className="font-medium">CRM comercial: </span>
          {query.isPending
            ? "Carregando…"
            : query.isError
              ? "Não foi possível carregar as oportunidades."
              : query.data?.opps.length
                ? query.data.opps.map((o) => (
                    <span
                      key={o.id}
                      className="mr-2 inline-block rounded-full bg-accent px-3 py-1 text-accent-foreground"
                    >
                      {o.title} · {query.data.stages.find((s) => s.id === o.stage_id)?.nome}
                    </span>
                  ))
                : "Nenhuma oportunidade criada."}
          <Link to="/crm" className="ml-3 text-primary underline">
            Abrir CRM
          </Link>
        </div>
      )}
    </section>
  );
}

