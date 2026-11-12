import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CostRow = {
  id_empresa: number | null;
  company: string;
  provider: string;
  environment: string;
  calls: number;
  measured_calls: number;
  estimated_calls: number;
  priced_calls: number;
  cache_unknown_calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  cost_min_usd: number | null;
  cost_max_usd: number | null;
};
export type CostReport = {
  rows: CostRow[];
  sources: {
    workflow_id: string;
    name: string;
    enabled: boolean;
    last_scan_at: string | null;
    environment: string;
  }[];
  queue: { pending: number; unavailable: number; last_collected_at: string | null };
  provider_costs: {
    provider: string;
    period_start: string;
    period_end: string;
    scope: string;
    amount_usd: number;
    source_file: string;
  }[];
  rates: {
    provider: string;
    model: string;
    valid_from: string;
    valid_to: string | null;
    input_usd_per_million: number;
    cached_usd_per_million: number;
    output_usd_per_million: number;
    source_url: string;
    notes: string;
  }[];
};
export const getAiCosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(v))
  .handler(async ({ data, context }): Promise<CostReport> => {
    const { data: me, error } = await context.supabase
      .from("crm_users")
      .select("role,active")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    if (!me?.active || me.role !== "super_admin")
      throw new Error("Acesso restrito ao Super Admin.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // New RPC is kept local until the shared generated database types are regenerated.
    const { data: report, error: reportError } = await (supabaseAdmin as any).rpc(
      "ai_cost_monthly_report",
      { p_month: `${data.month}-01` },
    );
    if (reportError) throw new Error("Não foi possível consultar os custos de IA.");
    return report as CostReport;
  });
