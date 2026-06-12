import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Empresas habilitadas no CRM Katsuki — filtradas por credentials.default_crm = 'katsuki'.
export function useAllowedEmpresas() {
  return useQuery({
    queryKey: ["allowed-empresas-katsuki"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<number[]> => {
      const { data, error } = await supabase
        .from("credentials")
        .select("id_empresa")
        .eq("default_crm", "katsuki");
      if (error) throw error;
      return (data ?? [])
        .map((r) => r.id_empresa as number | null)
        .filter((v): v is number => v != null);
    },
  });
}