import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  parseCommercialKey,
  parseCustomFieldOptions,
  type LeadCustomField,
  type LeadCustomFieldType,
} from "@/lib/lead-custom-fields";

export function useLeadCustomFields(idEmpresa?: number | null) {
  return useQuery({
    enabled: Boolean(idEmpresa),
    queryKey: ["lead-custom-fields", idEmpresa],
    queryFn: async () => {
      const load = (columns: string) =>
        supabase
          .from("crm_lead_custom_fields")
          .select(columns)
          .eq("id_empresa", idEmpresa!)
          .eq("ativo", true)
          .order("ordem", { ascending: true })
          .order("id", { ascending: true });

      const base = "id,id_empresa,nome,tipo,obrigatorio,opcoes,ordem,ativo";
      let result = await load(`${base},commercial_key`);
      // Enquanto a coluna opcional commercial_key não existir no banco, carrega sem ela.
      if (result.error && /commercial_key/.test(result.error.message ?? "")) {
        result = await load(base);
      }
      if (result.error) throw result.error;

      return ((result.data ?? []) as unknown as Array<Record<string, unknown>>).map((field) => ({
        ...field,
        tipo: field.tipo as LeadCustomFieldType,
        opcoes: parseCustomFieldOptions(field.opcoes),
        commercial_key: parseCommercialKey(field.commercial_key),
      })) as LeadCustomField[];
    },
  });
}
