import { useNavigate, useRouterState, Link } from "@tanstack/react-router";
import { LogOut, ChevronRight, User } from "lucide-react";
import type { ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/app-sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getInitials, colorFromString } from "@/lib/lead-visuals";
import { NotificationsBell } from "@/components/notifications-bell";

const ROUTE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  kanban: "Kanban",
  leads: "Leads",
  conversas: "Conversas",
  new: "Novo",
  settings: "Configurações",
  stages: "Estágios",
  tags: "Tags",
  users: "Usuários",
  admin: "Admin",
  empresas: "Empresas",
};

function useBreadcrumbs(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  return parts.map((p, i) => ({
    label: ROUTE_LABELS[p] ?? decodeURIComponent(p),
    href: "/" + parts.slice(0, i + 1).join("/"),
    last: i === parts.length - 1,
  }));
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useCrmUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const crumbs = useBreadcrumbs(pathname);

  const { data: empresa } = useQuery({
    enabled: !!me?.id_empresa,
    queryKey: ["empresa-name", me?.id_empresa],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("empresa_dados")
        .select("nome")
        .eq("id", me!.id_empresa!)
        .maybeSingle();
      return data?.nome ?? null;
    },
  });

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const initials = getInitials(me?.nome ?? me?.email, "U");
  const avatarColor = colorFromString(me?.nome ?? me?.email);

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="h-14 border-b flex items-center justify-between px-4 md:px-6"
          style={{ backgroundColor: "#FFFFFF", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}
        >
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-1.5 text-sm min-w-0">
            <Link to="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
              Home
            </Link>
            {crumbs.map((c) => (
              <div key={c.href} className="flex items-center gap-1.5 min-w-0">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                {c.last ? (
                  <span className="font-medium text-foreground truncate">{c.label}</span>
                ) : (
                  <Link to={c.href} className="text-muted-foreground hover:text-foreground transition-colors truncate">
                    {c.label}
                  </Link>
                )}
              </div>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {empresa && (
              <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[160px]">
                {empresa}
              </span>
            )}
            <NotificationsBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 pl-2 ml-1 border-l h-9 outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-md cursor-pointer" style={{ borderColor: "var(--border)" }}>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs font-semibold text-white" style={{ backgroundColor: avatarColor }}>
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden sm:block text-sm leading-tight text-left max-w-[140px]">
                    <div className="font-medium truncate">{me?.nome ?? "Usuário"}</div>
                    <div className="text-xs text-muted-foreground truncate">{me?.email}</div>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium truncate">{me?.nome}</div>
                  <div className="text-xs text-muted-foreground truncate">{me?.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate({ to: "/profile" })}>
                  <User className="h-4 w-4 mr-2" />
                  Meu Perfil
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                  <LogOut className="h-4 w-4 mr-2" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
