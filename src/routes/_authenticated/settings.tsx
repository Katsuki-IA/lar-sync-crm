import { createFileRoute, Link, Outlet, useRouterState, redirect } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";

export const Route = createFileRoute("/_authenticated/settings")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: me } = await supabase
      .from("crm_users")
      .select("role")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();
    if (!me || (me.role !== "manager" && me.role !== "super_admin")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: SettingsLayout,
});

function SettingsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: me } = useCrmUser();
  const tabs = me?.role === "super_admin"
    ? [
        { to: "/admin/funnel", label: "Funil e etapas" },
        { to: "/admin/tags", label: "Tags" },
        { to: "/admin/custom-fields", label: "Campos do lead" },
        { to: "/settings/users", label: "Usuários" },
      ]
    : [
        { to: "/settings/users", label: "Usuários" },
      ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie o cadastro e a operação da sua empresa.
        </p>
      </div>
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => {
          const active = pathname === t.to || pathname.startsWith(`${t.to}/`);
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      <Outlet />
    </div>
  );
}
