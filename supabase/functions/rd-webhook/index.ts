import { createSupabaseAdmin } from "../_shared/meta.ts";
import {
  markRdEventFailed,
  PermanentRdPayloadError,
  processRdEventWithRouting,
  type RdWebhookPayload,
} from "../_shared/rd-lead.ts";
import { sha256Hex } from "../_shared/rd.ts";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeTimestamp(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ error: "Método não permitido" }, 405);
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return response({ error: "Webhook não autorizado" }, 401);

  const supabaseAdmin = createSupabaseAdmin();
  const { data: connection, error: connectionError } = await supabaseAdmin
    .from("crm_rd_connections")
    .select("id,id_empresa,default_id_empreendimento,active")
    .eq("webhook_secret_hash", await sha256Hex(token))
    .eq("active", true)
    .maybeSingle();
  if (connectionError) return response({ error: "Falha ao validar conexão" }, 500);
  if (!connection) return response({ error: "Webhook não autorizado" }, 401);

  let payload: RdWebhookPayload;
  try {
    payload = (await req.json()) as RdWebhookPayload;
  } catch {
    return response({ error: "JSON inválido" }, 400);
  }

  const eventType = payload.event_type ?? "UNKNOWN";
  const eventIdentifier = payload.event_identifier?.trim() || null;
  const eventTimestamp = safeTimestamp(payload.event_timestamp ?? payload.timestamp);
  const contact = payload.contact ?? {};
  const contactUuid = contact.uuid?.trim() || null;
  const email = contact.email?.trim().toLowerCase() || null;
  const eventKey = await sha256Hex(
    [eventType, eventIdentifier, contactUuid, email, eventTimestamp].join("|"),
  );

  const { data: event, error: eventError } = await supabaseAdmin
    .from("crm_rd_events")
    .upsert(
      {
        id_empresa: connection.id_empresa,
        connection_id: connection.id,
        event_key: eventKey,
        event_type: eventType,
        event_identifier: eventIdentifier,
        event_timestamp: eventTimestamp,
        contact_uuid: contactUuid,
        contact_email: email,
        raw_data: payload,
      },
      { onConflict: "id_empresa,event_key" },
    )
    .select(
      "id,id_empresa,connection_id,event_identifier,event_timestamp,contact_uuid,contact_email,raw_data,status,crm_lead_id",
    )
    .single();
  if (eventError) return response({ error: "Falha ao registrar evento" }, 500);
  if (event.status === "processed" || event.status === "ignored") {
    return response({ received: true, duplicate: true, leadId: event.crm_lead_id });
  }

  if (eventType !== "WEBHOOK.CONVERTED" || payload.entity_type !== "CONTACT") {
    await supabaseAdmin
      .from("crm_rd_events")
      .update({ status: "ignored", processed_at: new Date().toISOString() })
      .eq("id", event.id);
    return response({ received: true, ignored: true });
  }

  try {
    const result = await processRdEventWithRouting({
      event: { ...event, raw_data: payload },
      connection,
    });
    return response({
      received: true,
      processed: !result.pending,
      pendingMapping: result.pending,
      leadId: result.leadId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao processar lead RD";
    await markRdEventFailed({
      eventId: event.id,
      connectionId: connection.id,
      message,
    });
    console.error("Falha ao processar webhook RD", error);
    return response(
      { received: true, processed: false, error: message },
      error instanceof PermanentRdPayloadError ? 200 : 500,
    );
  }
});
