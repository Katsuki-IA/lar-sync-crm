import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/settings/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });

    const { data: me } = await supabase
      .from("crm_users")
      .select("role")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();

    if (me?.role === "super_admin") {
      throw redirect({ to: "/admin/funnel" });
    }

    throw redirect({ to: "/settings/users" });
  },
});
