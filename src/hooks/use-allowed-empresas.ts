import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";

// Empresas habilitadas no CRM Hub — filtradas por credentials.default_crm = 'hub'.
export function useAllowedEmpresas() {
  const { data: me } = useCrmUser();

  return useQuery({
    enabled: !!me,
    queryKey: ["allowed-empresas-hub", me?.id, me?.id_empresa, me?.role],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<number[]> => {
      if (me?.role !== "super_admin") {
        return me?.id_empresa ? [me.id_empresa] : [];
      }

      const { data, error } = await supabase
        .from("credentials")
        .select("id_empresa")
        .eq("default_crm", "hub");
      if (error) throw error;
      return (data ?? [])
        .map((r) => r.id_empresa as number | null)
        .filter((v): v is number => v != null);
    },
  });
}
