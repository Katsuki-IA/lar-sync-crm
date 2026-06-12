import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Funnel = {
  id: number;
  id_empresa: number;
  nome: string;
  is_default: boolean;
  ativo: boolean;
  ordem: number;
};

export function useFunnels(idEmpresa: number | null | undefined) {
  return useQuery({
    enabled: !!idEmpresa,
    queryKey: ["crm-funnels", idEmpresa],
    queryFn: async (): Promise<Funnel[]> => {
      const { data, error } = await supabase
        .from("crm_funnels")
        .select("id, id_empresa, nome, is_default, ativo, ordem")
        .eq("id_empresa", idEmpresa!)
        .eq("ativo", true)
        .order("ordem", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Funnel[];
    },
    staleTime: 60_000,
  });
}