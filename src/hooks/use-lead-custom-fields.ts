import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  parseCustomFieldOptions,
  type LeadCustomField,
  type LeadCustomFieldType,
} from "@/lib/lead-custom-fields";

export function useLeadCustomFields(idEmpresa?: number | null) {
  return useQuery({
    enabled: Boolean(idEmpresa),
    queryKey: ["lead-custom-fields", idEmpresa],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_lead_custom_fields")
        .select("id,id_empresa,nome,tipo,obrigatorio,opcoes,ordem,ativo")
        .eq("id_empresa", idEmpresa!)
        .eq("ativo", true)
        .order("ordem", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;

      return (data ?? []).map((field) => ({
        ...field,
        tipo: field.tipo as LeadCustomFieldType,
        opcoes: parseCustomFieldOptions(field.opcoes),
      })) as LeadCustomField[];
    },
  });
}
