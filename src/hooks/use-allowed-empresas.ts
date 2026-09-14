import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";

// The database function applies the current user's RLS-backed company access.
export function useAllowedEmpresas() {
  const { data: me } = useCrmUser();

  return useQuery({
    enabled: !!me,
    queryKey: ["allowed-empresas-hub", me?.id, me?.id_empresa, me?.role],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<number[]> => {
      const { data, error } = await supabase.rpc("crm_get_allowed_empresas");
      if (error) throw error;
      return (data ?? []).map((id) => id as number | null).filter((v): v is number => v != null);
    },
  });
}
