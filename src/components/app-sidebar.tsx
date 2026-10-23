import { useCompanyModules } from "@/hml/modules";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Settings,
  Shield,
  BarChart2,
  Plug,
  MessagesSquare,
  ChartNoAxesCombined,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCrmUser } from "@/hooks/use-crm-user";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, colorFromString } from "@/lib/lead-visuals";

type Item = { title: string; url: string; match: string; icon: typeof LayoutDashboard };

function roleLabel(role?: string | null) {
  if (role === "super_admin") return "Super Admin";
  if (role === "manager") return "Gestor";
  if (role === "agent") return "Corretor";
  if (role === "analyst") return "Analista";
  return "Usuário";
}

export function AppSidebar({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: me } = useCrmUser();
  const { data: modules } = useCompanyModules();

  const mainItems: Item[] = [
    { title: "Dashboard", url: "/dashboard", match: "/dashboard", icon: LayoutDashboard },
    ...(me?.role === "analyst"
      ? []
      : [
          { title: "Leads", url: "/leads", match: "/leads", icon: Users },
          ...(modules?.atendimento_ia ? [{ title: "Conversas", url: "/conversas", match: "/conversas", icon: MessagesSquare }] : []),
        ]),
    ...(me?.role === "manager" || me?.role === "super_admin" || me?.role === "analyst"
      ? [
          {
            title: "Análise de Funil",
            url: "/analise-conversas",
            match: "/analise-conversas",
            icon: ChartNoAxesCombined,
          },
          {
            title: "Relatório de Leads",
            url: "/relatorio-leads",
            match: "/relatorio-leads",
            icon: BarChart2,
          },
        ]
      : []),
    { title: "Relatórios", url: "/relatorios", match: "/relatorios", icon: BarChart2 },
  ];

  if (me?.role !== "analyst" && modules?.atendimento_ia) {
    mainItems.push({title:"Atendimento IA",url:"/kanban",match:"/kanban",icon:MessagesSquare});
  }
  if (me?.role !== "analyst" && modules?.crm) {
    mainItems.push(
      {title:"CRM comercial",url:"/crm",match:"/crm",icon:Users},
      {title:"Tarefas",url:"/tarefas",match:"/tarefas",icon:LayoutDashboard},
      {title:me?.role === "agent" ? "Minhas ofertas" : "Filas de distribuição",url:"/filas",match:"/filas",icon:Users});
  }
  const adminItems: Item[] = [];
  if (me?.role === "super_admin") adminItems.push({title:"Empresas e módulos",url:"/modulos",match:"/modulos",icon:Shield});
  if (me?.role === "super_admin" || me?.role === "manager") {
    adminItems.push({title:"Empresa e empreendimentos",url:"/administracao",match:"/administracao",icon:Settings});
    adminItems.push({title:"Configuração dos módulos",url:"/configuracoes",match:"/configuracoes",icon:Settings});
  }
  if (me?.role === "manager" || me?.role === "super_admin") {
    adminItems.push({
      title: "Configurações",
      url: "/settings/users",
      match: "/settings",
      icon: Settings,
    });
  }
  if (me?.role === "manager" && modules?.atendimento_ia) {
    adminItems.push({
      title: "Integrações",
      url: "/configuracoes/integracoes",
      match: "/configuracoes/integracoes",
      icon: Plug,
    });
  }
  if (me?.role === "super_admin") {
    adminItems.push({
      title: "Super Admin",
      url: "/admin/empresas",
      match: "/admin",
      icon: Shield,
    });
  }

  const initials = getInitials(me?.nome ?? me?.email, "U");
  const avatarColor = colorFromString(me?.nome ?? me?.email);

  return (
    <aside
      className={cn(
        "flex-col text-sidebar-foreground border-r shrink-0",
        mobile ? "flex h-full min-h-0 w-full" : "hidden md:flex w-60",
      )}
      style={{ backgroundColor: "var(--sidebar)", borderColor: "var(--border)" }}
    >
      <div
        className="flex shrink-0 items-center justify-center px-5 border-b"
        style={{ height: 72, borderColor: "var(--border)" }}
      >
        <img
          src="/katsuki-hub-laranja.png"
          alt="Katsuki HUB"
          className="object-contain"
          style={{ width: 140, height: "auto", maxWidth: "100%" }}
        />
      </div>

      <nav aria-label="Menu principal" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <SidebarGroup
          label="Principal"
          items={mainItems}
          pathname={pathname}
          onNavigate={onNavigate}
        />
        {!!adminItems.length && (
          <>
            <div className="my-4 h-px" style={{ backgroundColor: "var(--border)" }} />
            <SidebarGroup
              label="Administração"
              items={adminItems}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          </>
        )}
      </nav>

      {/* User */}
      <div
        className="shrink-0 p-3 border-t pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.04] transition-colors">
          <Avatar className="h-9 w-9">
            <AvatarFallback
              className="text-xs font-semibold text-white"
              style={{ backgroundColor: avatarColor }}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-sm font-medium text-foreground truncate">
              {me?.nome ?? "Usuário"}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">{roleLabel(me?.role)}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SidebarGroup({
  label,
  items,
  pathname,
  onNavigate,
}: {
  label: string;
  items: Item[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div>
      <div className="px-3 mb-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
        {label}
      </div>
      <div className="space-y-1">
        {items.map((item) => {
          const active = item.url === "/configuracoes" ? pathname.replace(/\/+$/, "") === "/configuracoes" : pathname.startsWith(item.match);
          return (
            <Link
              key={item.url}
              to={item.url}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all",
                active
                  ? "text-primary font-medium"
                  : "text-sidebar-foreground hover:bg-white/[0.04] hover:text-foreground",
              )}
              style={active ? { backgroundColor: "var(--sidebar-active-bg)" } : undefined}
            >
              {active && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r"
                  style={{ backgroundColor: "var(--primary)" }}
                />
              )}
              <item.icon className={cn("h-4 w-4", active ? "text-primary" : "")} />
              <span>{item.title}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

