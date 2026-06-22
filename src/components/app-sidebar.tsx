import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Users, Settings, Shield, BarChart2, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCrmUser } from "@/hooks/use-crm-user";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, colorFromString } from "@/lib/lead-visuals";
import katsukiLogo from "@/assets/katsuki-logo.jpg.asset.json";

type Item = { title: string; url: string; match: string; icon: typeof LayoutDashboard };

const mainItems: Item[] = [
  { title: "Dashboard", url: "/dashboard", match: "/dashboard", icon: LayoutDashboard },
  { title: "Leads", url: "/leads", match: "/leads", icon: Users },
  { title: "Relatórios", url: "/relatorios", match: "/relatorios", icon: BarChart2 },
];

function roleLabel(role?: string | null) {
  if (role === "super_admin") return "Super Admin";
  if (role === "manager") return "Gestor";
  if (role === "agent") return "Corretor";
  return "Usuário";
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: me } = useCrmUser();

  const adminItems: Item[] = [];
  if (me?.role === "manager" || me?.role === "super_admin") {
    adminItems.push({ title: "Configurações", url: "/settings/stages", match: "/settings", icon: Settings });
    adminItems.push({ title: "Integrações", url: "/configuracoes/integracoes", match: "/configuracoes", icon: Plug });
  }
  if (me?.role === "super_admin") {
    adminItems.push({ title: "Super Admin", url: "/admin/empresas", match: "/admin", icon: Shield });
  }

  const initials = getInitials(me?.nome ?? me?.email, "U");
  const avatarColor = colorFromString(me?.nome ?? me?.email);

  return (
    <aside
      className="hidden md:flex flex-col text-sidebar-foreground border-r"
      style={{ width: 240, backgroundColor: "#0D0B09", borderColor: "#2A2520" }}
    >
      {/* Logo */}
      <div
        className="h-16 flex items-center gap-3 px-5 border-b"
        style={{ borderColor: "#2A2520" }}
      >
        <div className="h-9 w-9 rounded-xl overflow-hidden shadow-lg shadow-primary/30 ring-1 ring-white/10">
          <img src={katsukiLogo.url} alt="Katsuki" className="h-full w-full object-cover" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-bold text-[15px] text-foreground tracking-[0.18em]">KATSUKI</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Real Estate CRM</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <SidebarGroup label="Principal" items={mainItems} pathname={pathname} />
        {!!adminItems.length && (
          <>
            <div className="my-4 h-px" style={{ backgroundColor: "#2A2520" }} />
            <SidebarGroup label="Administração" items={adminItems} pathname={pathname} />
          </>
        )}
      </nav>

      {/* User */}
      <div className="p-3 border-t" style={{ borderColor: "#2A2520" }}>
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
            <div className="text-sm font-medium text-foreground truncate">{me?.nome ?? "Usuário"}</div>
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
}: {
  label: string;
  items: Item[];
  pathname: string;
}) {
  return (
    <div>
      <div className="px-3 mb-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
        {label}
      </div>
      <div className="space-y-1">
        {items.map((item) => {
          const active = pathname.startsWith(item.match);
          return (
            <Link
              key={item.url}
              to={item.url}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all",
                active
                  ? "text-primary font-medium"
                  : "text-sidebar-foreground hover:bg-white/[0.04] hover:text-foreground",
              )}
              style={
                active
                  ? { backgroundColor: "rgba(193,79,33,0.12)" }
                  : undefined
              }
            >
              {active && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r"
                  style={{ backgroundColor: "#C14F21" }}
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