import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ReportingIntegration = {
  id: string;
  nome: string;
  empresa_ids: number[];
  token_hash: string;
  token_prefix: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  request_window: string | null;
  request_count: number;
};

type ReportingDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      crm_reporting_integrations: {
        Row: ReportingIntegration;
        Insert: Pick<ReportingIntegration, "nome" | "empresa_ids" | "token_hash" | "token_prefix"> &
          Partial<ReportingIntegration>;
        Update: Partial<ReportingIntegration>;
        Relationships: [];
      };
    };
    Functions: Database["public"]["Functions"] & {
      crm_reporting_authorize: {
        Args: { p_hash: string };
        Returns: { integration_id: string; empresa_ids: number[]; rate_allowed: boolean }[];
      };
      crm_reporting_lead_page: {
        Args: {
          p_empresa: number;
          p_start: string;
          p_end: string;
          p_before?: number;
          p_limit: number;
        };
        Returns: Json;
      };
    };
  };
};

// Keep the generated schema file untouched; these types belong to this migration.
export const reportingDb = supabaseAdmin as unknown as SupabaseClient<ReportingDatabase>;

export async function requireReportingAdmin(authUserId: string) {
  const { data, error } = await reportingDb
    .from("crm_users")
    .select("id,role,active")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error || !data || data.role !== "super_admin" || data.active !== true) {
    throw new Error("Apenas Super Admin ativo pode gerenciar integrações de relatórios");
  }
  return data.id;
}
