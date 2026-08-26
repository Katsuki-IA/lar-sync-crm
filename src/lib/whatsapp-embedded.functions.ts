import { supabase } from "@/integrations/supabase/client";

export type WhatsAppConnectionStatus = {
  id: string;
  business_id: string | null;
  waba_id: string;
  business_name: string | null;
  status: "connected" | "attention" | "error";
  webhook_subscribed: boolean;
  phone_registered: boolean;
  connected_at: string;
  last_health_check_at: string | null;
  last_error: string | null;
  token_expires_at: string | null;
};

export type WhatsAppPhoneStatus = {
  phone_number_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  code_verification_status: string | null;
  name_status: string | null;
  platform_status: string | null;
};

export type WhatsAppIntegrationStatus = {
  configured: boolean;
  connection: WhatsAppConnectionStatus | null;
  phone: WhatsAppPhoneStatus | null;
};

export type WhatsAppEmbeddedStart = {
  appId: string;
  configId: string;
  graphVersion: string;
  sessionId: string;
};

async function getFunctionErrorMessage(error: unknown, fallback: string) {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json();
      if (typeof payload?.error === "string" && payload.error.trim()) return payload.error;
      if (typeof payload?.message === "string" && payload.message.trim()) return payload.message;
    } catch {
      // Keep the SDK error below.
    }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

async function invokeWhatsAppFunction<T>(name: string, body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body ?? {} });
  if (error) throw new Error(await getFunctionErrorMessage(error, `Falha ao executar ${name}`));
  if (!data) throw new Error(`Resposta vazia de ${name}`);
  return data;
}

export function getWhatsAppIntegrationStatus() {
  return invokeWhatsAppFunction<WhatsAppIntegrationStatus>("whatsapp-integration-status");
}

export function startWhatsAppEmbeddedSignup() {
  return invokeWhatsAppFunction<WhatsAppEmbeddedStart>("whatsapp-embedded-start");
}

export function finishWhatsAppEmbeddedSignup(data: {
  sessionId: string;
  code: string;
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
}) {
  return invokeWhatsAppFunction<{ ok: true }>("whatsapp-embedded-finish", data);
}

export function disconnectWhatsApp() {
  return invokeWhatsAppFunction<{ ok: true; warning?: string | null }>("whatsapp-disconnect");
}
