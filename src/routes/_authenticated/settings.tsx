import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { ConfigLayout } from "@/components/config-layout";
import { supabase } from "@/integrations/supabase/client";

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
  return (
    <ConfigLayout>
      <Outlet />
    </ConfigLayout>
  );
}
