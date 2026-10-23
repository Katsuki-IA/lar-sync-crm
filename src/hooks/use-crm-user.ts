import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeCompanyRole } from "@/hml/company-api";

export type CrmUser = {
  id: string;
  auth_user_id: string | null;
  id_empresa: number | null;
  nome: string;
  email: string;
  role: "super_admin" | "manager" | "agent" | "analyst";
  active: boolean | null;
};

export function useCrmUser() {
  return useQuery({
    queryKey: ["crm-user-me"],
    queryFn: async (): Promise<CrmUser | null> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data, error } = await supabase
        .from("crm_users")
        .select("id,auth_user_id,id_empresa,nome,email,role,active")
        .eq("auth_user_id", auth.user.id)
        .maybeSingle();
      if (error) throw error;
      if(!data)return null;
      const role=normalizeCompanyRole(data.role);
      if(!role)throw new Error("Perfil de acesso não reconhecido. Contate a administração.");
      return {...data,role} as CrmUser;
    },
    staleTime: 60_000,
  });
}

