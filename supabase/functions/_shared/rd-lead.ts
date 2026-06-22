import { createSupabaseAdmin } from "./meta.ts";
import { normalizeBrazilPhone } from "./meta-lead.ts";
import { resolveRdOrigin } from "./rd.ts";

export type RdContact = {
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

export type RdWebhookPayload = {
  event_type?: string;
  entity_type?: string;
  event_identifier?: string;
  timestamp?: string;
  event_timestamp?: string;
  contact?: RdContact;
};

export type RdStoredEvent = {
  id: string;
  id_empresa: number;
  connection_id: string | null;
  event_identifier: string | null;
  event_timestamp: string | null;
  contact_uuid: string | null;
  contact_email: string | null;
  raw_data: RdWebhookPayload;
};

export type RdConnectionContext = {
  id: string;
  id_empresa: number;
  default_id_empreendimento: number | null;
};

export class PermanentRdPayloadError extends Error {}

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

async function resolveEventDestination(event: RdStoredEvent, connection: RdConnectionContext) {
  if (!event.event_identifier) {
    return {
      mappingId: null,
      empreendimentoId: connection.default_id_empreendimento,
      pendingReason: connection.default_id_empreendimento
        ? null
        : "Conversão RD sem identificador e sem empreendimento padrão",
    };
  }

  const supabaseAdmin = createSupabaseAdmin();
  const { data: mapping, error } = await supabaseAdmin
    .from("crm_rd_source_mappings")
    .upsert(
      {
        id_empresa: connection.id_empresa,
        connection_id: connection.id,
        event_identifier: event.event_identifier,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "id_empresa,event_identifier" },
    )
    .select("id,id_empreendimento,active")
    .single();
  if (error) throw new Error(error.message);

  const pendingReason = !mapping.active
    ? `Origem RD "${event.event_identifier}" está desativada`
    : !mapping.id_empreendimento
      ? `Origem RD "${event.event_identifier}" aguardando vínculo com empreendimento`
      : null;
  return {
    mappingId: mapping.id,
    empreendimentoId: mapping.id_empreendimento as number | null,
    pendingReason,
  };
}

export async function processRdEventWithRouting(args: {
  event: RdStoredEvent;
  connection: RdConnectionContext;
}) {
  const supabaseAdmin = createSupabaseAdmin();
  const destination = await resolveEventDestination(args.event, args.connection);
  if (destination.pendingReason || !destination.empreendimentoId) {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("crm_rd_events")
      .update({
        source_mapping_id: destination.mappingId,
        id_empreendimento: destination.empreendimentoId,
        status: "pending_mapping",
        error: destination.pendingReason ?? "Empreendimento da conversão não configurado",
        processed_at: null,
      })
      .eq("id", args.event.id);
    if (error) throw new Error(error.message);
    await supabaseAdmin
      .from("crm_rd_connections")
      .update({ last_event_at: now })
      .eq("id", args.connection.id);
    return { pending: true as const, leadId: null };
  }

  const contact = args.event.raw_data.contact ?? {};
  const email = args.event.contact_email;
  const contactUuid = args.event.contact_uuid;
  const rawPhone = contact.mobile_phone?.trim() || contact.personal_phone?.trim() || "";
  const normalizedPhone = normalizeBrazilPhone(rawPhone).normalized;
  const existingLeadId = await findExistingLead({
    idEmpresa: args.connection.id_empresa,
    eventId: args.event.id,
    contactUuid,
    phone: normalizedPhone,
    email,
  });
  let leadId = existingLeadId;

  if (!leadId) {
    if (!normalizedPhone) {
      throw new PermanentRdPayloadError("Contato RD sem telefone e sem lead existente por email");
    }
    const routing = await getDefaultRouting(args.connection.id_empresa);
    const fallbackName = email?.split("@")[0] || "Lead RD Station";
    const { data: lead, error: leadError } = await supabaseAdmin
      .from("crm_leads")
      .insert({
        id_empresa: args.connection.id_empresa,
        nome: contact.name?.trim() || fallbackName,
        telefone: normalizedPhone,
        email,
        origem: resolveRdOrigin(contact.funnel?.origin),
        id_empreendimento: destination.empreendimentoId,
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
      ? `Nova conversão recebida pelo RD Station (${args.event.event_identifier ?? "sem identificador"})`
      : `Lead recebido pelo RD Station (${args.event.event_identifier ?? "sem identificador"})`,
    metadata: {
      source: "rd_station",
      rd_event_id: args.event.id,
      contact_uuid: contactUuid,
      event_identifier: args.event.event_identifier,
      event_timestamp: args.event.event_timestamp,
      id_empreendimento: destination.empreendimentoId,
      duplicate_contact: Boolean(existingLeadId),
    },
  });
  if (activityError) throw new Error(activityError.message);

  const processedAt = new Date().toISOString();
  const [{ error: eventUpdateError }, { error: connectionUpdateError }] = await Promise.all([
    supabaseAdmin
      .from("crm_rd_events")
      .update({
        source_mapping_id: destination.mappingId,
        id_empreendimento: destination.empreendimentoId,
        status: "processed",
        crm_lead_id: leadId,
        error: null,
        processed_at: processedAt,
      })
      .eq("id", args.event.id),
    supabaseAdmin
      .from("crm_rd_connections")
      .update({ last_event_at: processedAt, last_error: null })
      .eq("id", args.connection.id),
  ]);
  if (eventUpdateError) throw new Error(eventUpdateError.message);
  if (connectionUpdateError) throw new Error(connectionUpdateError.message);
  return { pending: false as const, leadId };
}

export async function markRdEventFailed(args: {
  eventId: string;
  connectionId: string;
  message: string;
}) {
  const supabaseAdmin = createSupabaseAdmin();
  const now = new Date().toISOString();
  await Promise.all([
    supabaseAdmin
      .from("crm_rd_events")
      .update({ status: "failed", error: args.message, processed_at: now })
      .eq("id", args.eventId),
    supabaseAdmin
      .from("crm_rd_connections")
      .update({ last_event_at: now, last_error: args.message })
      .eq("id", args.connectionId),
  ]);
}
