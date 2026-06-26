import { supabase } from "@/integrations/supabase/client";

export type ExternalCrmProvider = {
  provider: "rd_station" | "cv_crm" | "c2s" | "kommo" | "loft" | "custom";
  label: string;
  available: boolean;
  connection: ExternalCrmConnection | null;
};

export type ExternalCrmConnection = {
  id: string;
  provider: string;
  provider_label: string;
  account_id: string | null;
  account_name: string | null;
  settings: {
    rd_funnel_id?: string | null;
    rd_funnel_name?: string | null;
    rd_stage_id?: string | null;
    rd_stage_name?: string | null;
  } | null;
  active: boolean;
  connected_at: string | null;
  last_error: string | null;
};

export type ExternalCrmsStatus = {
  providers: ExternalCrmProvider[];
};

export type ExternalCrmRdFunnel = {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }>;
};

async function getFunctionErrorMessage(error: unknown, fallback: string) {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json();
      if (typeof payload?.error === "string" && payload.error.trim()) return payload.error;
      if (typeof payload?.message === "string" && payload.message.trim()) return payload.message;
    } catch {
      // Use the SDK error below.
    }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

async function invokeExternalCrmFunction<T>(name: string, body?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body ?? {} });
  if (error) throw new Error(await getFunctionErrorMessage(error, `Falha ao executar ${name}`));
  if (!data) throw new Error(`Resposta vazia de ${name}`);
  return data;
}

export function getExternalCrmsStatus() {
  return invokeExternalCrmFunction<ExternalCrmsStatus>("external-crms-status");
}

export function createExternalCrmRdOAuthUrl() {
  return invokeExternalCrmFunction<{ url: string }>("external-crms-rd-oauth-start");
}

export function exchangeExternalCrmRdCode(data: { code: string; state: string }) {
  return invokeExternalCrmFunction<{ ok: true; connection: ExternalCrmConnection }>(
    "external-crms-rd-oauth-exchange",
    data,
  );
}

export function getExternalCrmRdFunnels() {
  return invokeExternalCrmFunction<{
    funnels: ExternalCrmRdFunnel[];
    warning: string | null;
    details?: string[];
  }>("external-crms-rd-funnels");
}

export function saveExternalCrmSettings(data: {
  provider: "rd_station";
  rdFunnelId: string;
  rdFunnelName: string;
  rdStageId: string;
  rdStageName: string;
}) {
  return invokeExternalCrmFunction<{ ok: true; connection: ExternalCrmConnection }>(
    "external-crms-save-settings",
    data,
  );
}

export function disconnectExternalCrm(provider: "rd_station") {
  return invokeExternalCrmFunction<{ ok: true }>("external-crms-disconnect", { provider });
}
