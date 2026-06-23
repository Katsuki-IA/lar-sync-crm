import { supabase } from "@/integrations/supabase/client";

export type RdConnectionStatus = {
  id: string;
  platform_account_id: string | null;
  connected_at: string;
  active: boolean;
  default_id_empreendimento: number | null;
  last_event_at: string | null;
  last_error: string | null;
  webhook_uuid: string | null;
};

export type RdIntegrationStatus = {
  connection: RdConnectionStatus | null;
  empreendimentos: Array<{ id: number; nome: string }>;
  summary: { total: number; processed: number; failed: number; pending: number };
  sources: Array<{
    event_identifier: string;
    mapping_id: string | null;
    id_empreendimento: number | null;
    active: boolean;
    uses_default: boolean;
    total: number;
    processed: number;
    failed: number;
    pending: number;
    last_received_at: string | null;
  }>;
  recentEvents: Array<{
    id: string;
    event_type: string;
    event_identifier: string | null;
    event_timestamp: string | null;
    contact_email: string | null;
    crm_lead_id: number | null;
    status: "received" | "pending_mapping" | "processed" | "failed" | "ignored";
    error: string | null;
    received_at: string;
    id_empreendimento: number | null;
    source_mapping_id: string | null;
  }>;
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

async function invokeRdFunction<T>(name: string, body?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body ?? {} });
  if (error) throw new Error(await getFunctionErrorMessage(error, `Falha ao executar ${name}`));
  if (!data) throw new Error(`Resposta vazia de ${name}`);
  return data;
}

export function getRdIntegrationStatus() {
  return invokeRdFunction<RdIntegrationStatus>("rd-integration-status");
}

export function syncRdAssets() {
  return invokeRdFunction<{
    ok: true;
    found: number;
    created: number;
  }>("rd-assets-sync");
}

export function createRdOAuthUrl(empreendimentoId: number) {
  return invokeRdFunction<{ url: string }>("rd-oauth-start", { empreendimentoId });
}

export function exchangeRdCode(data: { code: string; state: string }) {
  return invokeRdFunction<{ ok: true; connection: RdConnectionStatus }>("rd-oauth-exchange", data);
}

export function saveRdSettings(empreendimentoId: number) {
  return invokeRdFunction<{ ok: true }>("rd-settings-save", { empreendimentoId });
}

export function saveRdSourceMapping(eventIdentifier: string, empreendimentoId: number) {
  return invokeRdFunction<{
    ok: true;
    reprocessed: number;
    failed: number;
  }>("rd-source-mapping-save", { eventIdentifier, empreendimentoId });
}

export function disconnectRdConnection() {
  return invokeRdFunction<{ ok: true; warning: string | null }>("rd-disconnect");
}
