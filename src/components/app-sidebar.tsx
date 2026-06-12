import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, KanbanSquare, Users, Flame, Settings, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCrmUser } from "@/hooks/use-crm-user";

const baseItems = [
  { title: "Dashboard", url: "/dashboard", match: "/dashboard", icon: LayoutDashboard },
  { title: "Kanban", url: "/kanban", match: "/kanban", icon: KanbanSquare },
  { title: "Leads", url: "/leads", match: "/leads", icon: Users },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: me } = useCrmUser();
  const items = [
    ...baseItems,
    ...(me?.role === "manager" || me?.role === "super_admin"
      ? [{ title: "Configurações", url: "/settings/stages", match: "/settings", icon: Settings }]
      : []),
    ...(me?.role === "super_admin"
      ? [{ title: "Super Admin", url: "/admin/empresas", match: "/admin", icon: Shield }]
      : []),
  ];
  return (
    <aside className="hidden md:flex w-60 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="h-14 flex items-center gap-2 px-5 border-b border-sidebar-border">
        <div className="h-8 w-8 rounded-xl bg-primary flex items-center justify-center text-primary-foreground">
          <Flame className="h-4 w-4" />
        </div>
        <span className="font-semibold text-sidebar-primary-foreground">Ember CRM</span>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {items.map((item) => {
          const active = pathname.startsWith(item.match);
          return (
            <Link
              key={item.url}
              to={item.url}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "hover:bg-sidebar-accent/60 text-sidebar-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              <span>{item.title}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}