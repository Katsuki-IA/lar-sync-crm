import { createSupabaseAdmin } from "../_shared/meta.ts";
import { normalizeBrazilPhone } from "../_shared/meta-lead.ts";
import { resolveRdOrigin, sha256Hex } from "../_shared/rd.ts";

type RdContact = {
  uuid?: string;
  email?: string;
  name?: string;
  mobile_phone?: string;
  personal_phone?: string;
  tags?: string[];
  company?: { name?: string };
  funnel?: { origin?: string; lifecycle_stage?: string; contact_owner_email?: string };
  [key: string]: unknown;
};

type RdWebhookPayload = {
  event_type?: string;
  entity_type?: string;
  event_identifier?: string;
  timestamp?: string;
  event_timestamp?: string;
  contact?: RdContact;
};

class PermanentPayloadError extends Error {}

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

async function getDefaultRouting(idEmpresa: number) {
  const supabaseAdmin = createSupabaseAdmin();
  const [{ data: manager, error: managerError }, { data: funnel, error: funnelError }] =
    await Promise.all([
      supabaseAdmin
        .from("crm_users")
        .select("id")
        .eq("id_empresa", idEmpresa)
        .eq("role", "manager")
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("crm_funnels")
        .select("id")
        .eq("id_empresa", idEmpresa)
        .eq("is_default", true)
        .maybeSingle(),
    ]);
  if (managerError) throw new Error(managerError.message);
  if (funnelError) throw new Error(funnelError.message);

  let stageQuery = supabaseAdmin
    .from("crm_stages")
    .select("id")
    .eq("id_empresa", idEmpresa)
    .eq("ativo", true)
    .order("ordem", { ascending: true })
    .limit(1);
  if (funnel?.id) stageQuery = stageQuery.eq("id_funnel", funnel.id);
  const { data: stage, error: stageError } = await stageQuery.maybeSingle();
  if (stageError) throw new Error(stageError.message);
  return { assignedTo: manager?.id ?? null, stageId: stage?.id ?? null };
}

async function findExistingLead(args: {
  idEmpresa: number;
  eventId: string;
  contactUuid: string | null;
  phone: string;
  email: string | null;
}) {
  const supabaseAdmin = createSupabaseAdmin();
  if (args.contactUuid) {
    const { data: previous, error } = await supabaseAdmin
      .from("crm_rd_events")
      .select("crm_lead_id")
      .eq("id_empresa", args.idEmpresa)
      .eq("contact_uuid", args.contactUuid)
      .neq("id", args.eventId)
      .not("crm_lead_id", "is", null)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (previous?.crm_lead_id) return previous.crm_lead_id as number;
  }
  if (args.phone) {
    const { data: lead, error } = await supabaseAdmin
      .from("crm_leads")
      .select("id")
      .eq("id_empresa", args.idEmpresa)
      .eq("telefone", args.phone)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (lead?.id) return lead.id as number;
  }
  if (args.email) {
    const { data: lead, error } = await supabaseAdmin
      .from("crm_leads")
      .select("id")
      .eq("id_empresa", args.idEmpresa)
      .ilike("email", args.email)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (lead?.id) return lead.id as number;
  }
  return null;
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
    .select("id,status,crm_lead_id")
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
    if (!connection.default_id_empreendimento) {
      throw new PermanentPayloadError("Conexão RD sem empreendimento padrão");
    }
    const rawPhone = contact.mobile_phone?.trim() || contact.personal_phone?.trim() || "";
    const normalizedPhone = normalizeBrazilPhone(rawPhone).normalized;
    const existingLeadId = await findExistingLead({
      idEmpresa: connection.id_empresa,
      eventId: event.id,
      contactUuid,
      phone: normalizedPhone,
      email,
    });
    let leadId = existingLeadId;

    if (!leadId) {
      if (!normalizedPhone) {
        throw new PermanentPayloadError("Contato RD sem telefone e sem lead existente por email");
      }
      const routing = await getDefaultRouting(connection.id_empresa);
      const fallbackName = email?.split("@")[0] || "Lead RD Station";
      const { data: lead, error: leadError } = await supabaseAdmin
        .from("crm_leads")
        .insert({
          id_empresa: connection.id_empresa,
          nome: contact.name?.trim() || fallbackName,
          telefone: normalizedPhone,
          email,
          origem: resolveRdOrigin(contact.funnel?.origin),
          id_empreendimento: connection.default_id_empreendimento,
          crm_stage_id: routing.stageId,
          crm_assigned_to: routing.assignedTo,
        })
        .select("id")
        .single();
      if (leadError) throw new Error(leadError.message);
      leadId = lead.id;
    } else if (email) {
      const { data: currentLead, error: currentError } = await supabaseAdmin
        .from("crm_leads")
        .select("email")
        .eq("id", leadId)
        .single();
      if (currentError) throw new Error(currentError.message);
      if (!currentLead.email) {
        const { error: updateError } = await supabaseAdmin
          .from("crm_leads")
          .update({ email })
          .eq("id", leadId);
        if (updateError) throw new Error(updateError.message);
      }
    }

    const { error: activityError } = await supabaseAdmin.from("crm_lead_activities").insert({
      lead_id: leadId,
      crm_user_id: null,
      tipo: existingLeadId ? "rd_conversion" : "system",
      descricao: existingLeadId
        ? `Nova conversão recebida pelo RD Station (${eventIdentifier ?? "sem identificador"})`
        : `Lead recebido pelo RD Station (${eventIdentifier ?? "sem identificador"})`,
      metadata: {
        source: "rd_station",
        rd_event_id: event.id,
        contact_uuid: contactUuid,
        event_identifier: eventIdentifier,
        event_timestamp: eventTimestamp,
        duplicate_contact: Boolean(existingLeadId),
      },
    });
    if (activityError) throw new Error(activityError.message);

    const processedAt = new Date().toISOString();
    const [{ error: eventUpdateError }, { error: connectionUpdateError }] = await Promise.all([
      supabaseAdmin
        .from("crm_rd_events")
        .update({
          status: "processed",
          crm_lead_id: leadId,
          error: null,
          processed_at: processedAt,
        })
        .eq("id", event.id),
      supabaseAdmin
        .from("crm_rd_connections")
        .update({ last_event_at: processedAt, last_error: null })
        .eq("id", connection.id),
    ]);
    if (eventUpdateError) throw new Error(eventUpdateError.message);
    if (connectionUpdateError) throw new Error(connectionUpdateError.message);
    return response({ received: true, processed: true, leadId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao processar lead RD";
    await Promise.all([
      supabaseAdmin
        .from("crm_rd_events")
        .update({ status: "failed", error: message, processed_at: new Date().toISOString() })
        .eq("id", event.id),
      supabaseAdmin
        .from("crm_rd_connections")
        .update({ last_event_at: new Date().toISOString(), last_error: message })
        .eq("id", connection.id),
    ]);
    console.error("Falha ao processar webhook RD", error);
    return response(
      { received: true, processed: false, error: message },
      error instanceof PermanentPayloadError ? 200 : 500,
    );
  }
});
