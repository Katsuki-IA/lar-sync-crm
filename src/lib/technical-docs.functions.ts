import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// POST prevents intermediary GET caching of this restricted documentation.
export const getTechnicalDocs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("crm_users")
      .select("role,active")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (error || !data || data.role !== "super_admin" || data.active !== true) {
      throw new Error("Documentação disponível apenas para super admin ativo.");
    }
    const { technicalDocs } = await import("./technical-docs.server");
    return technicalDocs;
  });
