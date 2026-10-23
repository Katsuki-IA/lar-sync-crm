import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import type { SupabaseClient } from "@supabase/supabase-js";
import { companyApi } from "@/hml/company-api";

// HML overlay only: the production hook/RPC remain unchanged.
export function useAllowedEmpresas() {
  const { data: me } = useCrmUser();
  return useQuery({
    enabled: !!me,
    queryKey: ["allowed-empresas-hub", me?.id, me?.id_empresa, me?.role],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<number[]> => {
      const data = await companyApi(supabase as unknown as SupabaseClient).allowed();
      return (data ?? []).filter((id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id));
    },
  });
}

