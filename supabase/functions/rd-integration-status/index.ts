import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";

type SourceSummary = {
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
};

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();
    const [connectionResult, empreendimentosResult, eventsResult, mappingsResult] =
      await Promise.all([
        supabaseAdmin
          .from("crm_rd_connections")
          .select(
            "id,platform_account_id,connected_at,active,default_id_empreendimento,last_event_at,last_error,webhook_uuid",
          )
          .eq("id_empresa", crmUser.id_empresa)
          .eq("active", true)
          .maybeSingle(),
        supabaseAdmin
          .from("empreendimento")
          .select("id,nome")
          .eq("id_empresa", crmUser.id_empresa)
          .order("nome", { ascending: true }),
        supabaseAdmin
          .from("crm_rd_events")
          .select(
            "id,event_type,event_identifier,event_timestamp,contact_email,crm_lead_id,status,error,received_at,id_empreendimento,source_mapping_id",
          )
          .eq("id_empresa", crmUser.id_empresa)
          .order("received_at", { ascending: false })
          .limit(500),
        supabaseAdmin
          .from("crm_rd_source_mappings")
          .select("id,event_identifier,id_empreendimento,active,last_seen_at")
          .eq("id_empresa", crmUser.id_empresa)
          .order("event_identifier", { ascending: true }),
      ]);
    if (connectionResult.error) throw new Error(connectionResult.error.message);
    if (empreendimentosResult.error) throw new Error(empreendimentosResult.error.message);
    if (eventsResult.error) throw new Error(eventsResult.error.message);
    if (mappingsResult.error) throw new Error(mappingsResult.error.message);

    const connection = connectionResult.data;
    const events = eventsResult.data ?? [];
    const sourceMap = new Map<string, SourceSummary>();
    for (const mapping of mappingsResult.data ?? []) {
      sourceMap.set(mapping.event_identifier, {
        event_identifier: mapping.event_identifier,
        mapping_id: mapping.id,
        id_empreendimento: mapping.id_empreendimento,
        active: mapping.active,
        uses_default: false,
        total: 0,
        processed: 0,
        failed: 0,
        pending: 0,
        last_received_at: mapping.last_seen_at,
      });
    }

    for (const event of events) {
      const identifier = event.event_identifier || "Sem identificador";
      const current = sourceMap.get(identifier) ?? {
        event_identifier: identifier,
        mapping_id: event.source_mapping_id,
        id_empreendimento: event.event_identifier
          ? event.id_empreendimento
          : (connection?.default_id_empreendimento ?? null),
        active: true,
        uses_default: !event.event_identifier,
        total: 0,
        processed: 0,
        failed: 0,
        pending: 0,
        last_received_at: event.received_at,
      };
      current.total += 1;
      if (event.status === "processed") current.processed += 1;
      if (event.status === "failed") current.failed += 1;
      if (event.status === "pending_mapping") current.pending += 1;
      if (!current.last_received_at) current.last_received_at = event.received_at;
      sourceMap.set(identifier, current);
    }

    const sources = Array.from(sourceMap.values()).sort((a, b) => {
      const aPending = !a.id_empreendimento || a.pending > 0 ? 1 : 0;
      const bPending = !b.id_empreendimento || b.pending > 0 ? 1 : 0;
      return bPending - aPending || a.event_identifier.localeCompare(b.event_identifier, "pt-BR");
    });

    return jsonResponse({
      connection: connection ?? null,
      empreendimentos: empreendimentosResult.data ?? [],
      summary: {
        total: events.length,
        processed: events.filter((event) => event.status === "processed").length,
        failed: events.filter((event) => event.status === "failed").length,
        pending: events.filter((event) => event.status === "pending_mapping").length,
      },
      sources,
      recentEvents: events.slice(0, 10),
    });
  });
});
