import { supabase } from "@/integrations/supabase/client";

export type WhatsAppReviewTemplateComponent = {
  type?: string;
  text?: string;
  example?: { body_text?: string[][] };
  [key: string]: unknown;
};

export type WhatsAppReviewTemplate = {
  id?: string;
  name: string;
  status?: string;
  category?: string;
  language: string;
  components?: WhatsAppReviewTemplateComponent[];
  rejected_reason?: string;
  quality_score?: Record<string, unknown>;
};

export type WhatsAppReviewMessage = {
  id: string;
  message_id: string | null;
  direction: "inbound" | "outbound";
  from_wa_id: string | null;
  to_wa_id: string | null;
  contact_name: string | null;
  type: string | null;
  text_body: string | null;
  template_name: string | null;
  template_language: string | null;
  template_variables: unknown;
  timestamp_meta: string | null;
  status_current: string | null;
  status_last_at: string | null;
  error_code: string | null;
  error_message: string | null;
  raw: unknown;
  created_at: string;
};

export type WhatsAppReviewStatusEvent = {
  id: string;
  phone_number_id: string;
  message_id: string;
  recipient_id: string | null;
  status: string;
  timestamp_meta: string | null;
  error_code: string | null;
  error_message: string | null;
  raw: unknown;
  created_at: string;
};

export type WhatsAppReviewEvent = {
  id: string;
  phone_number_id: string | null;
  source: "hub" | "webhook";
  event_type: string;
  event_key: string;
  message_id: string | null;
  payload: unknown;
  occurred_at: string;
  created_at: string;
};

export type WhatsAppReviewState = {
  connection: { wabaId: string; businessName: string | null };
  phones: Array<{
    phone_number_id: string;
    display_phone_number: string | null;
    verified_name: string | null;
  }>;
  templates: WhatsAppReviewTemplate[];
  templatesError: string | null;
  messages: WhatsAppReviewMessage[];
  statusEvents: WhatsAppReviewStatusEvent[];
  events: WhatsAppReviewEvent[];
  webhook: { callbackUrl: string | null; verifyTokenConfigured: boolean };
};

async function functionError(error: unknown, fallback: string) {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json();
      if (typeof payload?.error === "string" && payload.error.trim()) return payload.error;
      if (typeof payload?.message === "string" && payload.message.trim()) return payload.message;
    } catch {
      // Preserve the SDK error below.
    }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

async function invokeReview<T>(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke<T>("whatsapp-review-tools", { body });
  if (error) throw new Error(await functionError(error, "Falha no ambiente de teste Meta"));
  if (!data) throw new Error("A Meta não retornou dados para o ambiente de teste");
  return data;
}

export function getWhatsAppReviewState(empresaId: number) {
  return invokeReview<WhatsAppReviewState>({ action: "get_state", empresaId });
}

export function createWhatsAppReviewTemplate(input: {
  empresaId: number;
  name: string;
  category: "UTILITY" | "MARKETING";
  language: string;
  body: string;
  examples: string[];
}) {
  return invokeReview<{ ok: true; template: WhatsAppReviewTemplate }>({
    action: "create_template",
    ...input,
  });
}

export function sendWhatsAppReviewTemplate(input: {
  empresaId: number;
  to: string;
  name: string;
  language: string;
  parameters: string[];
}) {
  return invokeReview<{ ok: true; messageId: string; status: string | null }>({
    action: "send_template",
    ...input,
  });
}
