import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import {
  markRdEventFailed,
  processRdEventWithRouting,
  type RdWebhookPayload,
} from "../_shared/rd-lead.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { eventIdentifier, empreendimentoId } = (await req.json()) as {
      eventIdentifier?: string;
      empreendimentoId?: number;
    };
    const normalizedIdentifier = eventIdentifier?.trim();
    if (!normalizedIdentifier) throw new Error("Identificador da conversão não informado");
    if (!empreendimentoId || !Number.isInteger(empreendimentoId)) {
      throw new Error("Selecione o empreendimento");
    }

    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();
    const [connectionResult, empreendimentoResult] = await Promise.all([
      supabaseAdmin
        .from("crm_rd_connections")
        .select("id,id_empresa,default_id_empreendimento")
        .eq("id_empresa", crmUser.id_empresa)
        .eq("active", true)
        .maybeSingle(),
      supabaseAdmin
        .from("empreendimento")
        .select("id")
        .eq("id", empreendimentoId)
        .eq("id_empresa", crmUser.id_empresa)
        .maybeSingle(),
    ]);
    if (connectionResult.error) throw new Error(connectionResult.error.message);
    if (empreendimentoResult.error) throw new Error(empreendimentoResult.error.message);
    if (!connectionResult.data) throw new Error("Conexão RD Station não encontrada");
    if (!empreendimentoResult.data) throw new Error("Empreendimento não pertence à empresa atual");

    const connection = connectionResult.data;
    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("crm_rd_source_mappings")
      .upsert(
        {
          id_empresa: crmUser.id_empresa,
          connection_id: connection.id,
          event_identifier: normalizedIdentifier,
          id_empreendimento: empreendimentoId,
          active: true,
        },
        { onConflict: "id_empresa,event_identifier" },
      )
      .select("id,event_identifier,id_empreendimento,active,last_seen_at")
      .single();
    if (mappingError) throw new Error(mappingError.message);

    const { data: pendingEvents, error: pendingError } = await supabaseAdmin
      .from("crm_rd_events")
      .select(
        "id,id_empresa,connection_id,event_identifier,event_timestamp,contact_uuid,contact_email,raw_data",
      )
      .eq("id_empresa", crmUser.id_empresa)
      .eq("event_identifier", normalizedIdentifier)
      .eq("status", "pending_mapping")
      .order("received_at", { ascending: true })
      .limit(50);
    if (pendingError) throw new Error(pendingError.message);

    let reprocessed = 0;
    let failed = 0;
    for (const event of pendingEvents ?? []) {
      try {
        const result = await processRdEventWithRouting({
          event: { ...event, raw_data: event.raw_data as RdWebhookPayload },
          connection,
        });
        if (!result.pending) reprocessed += 1;
      } catch (error) {
        failed += 1;
        await markRdEventFailed({
          eventId: event.id,
          connectionId: connection.id,
          message: error instanceof Error ? error.message : "Falha ao reprocessar conversão RD",
        });
      }
    }

    return jsonResponse({ ok: true, mapping, reprocessed, failed });
  });
});
