import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();
    const [{ data: connection, error: connectionError }, { data: empreendimentos, error: empError }] =
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
      ]);
    if (connectionError) throw new Error(connectionError.message);
    if (empError) throw new Error(empError.message);

    const { data: events, error: eventsError } = await supabaseAdmin
      .from("crm_rd_events")
      .select(
        "id,event_type,event_identifier,event_timestamp,contact_email,crm_lead_id,status,error,received_at",
      )
      .eq("id_empresa", crmUser.id_empresa)
      .order("received_at", { ascending: false })
      .limit(500);
    if (eventsError) throw new Error(eventsError.message);

    const sourceMap = new Map<
      string,
      { event_identifier: string; total: number; processed: number; failed: number; last_received_at: string }
    >();
    for (const event of events ?? []) {
      const identifier = event.event_identifier || "Sem identificador";
      const current = sourceMap.get(identifier) ?? {
        event_identifier: identifier,
        total: 0,
        processed: 0,
        failed: 0,
        last_received_at: event.received_at,
      };
      current.total += 1;
      if (event.status === "processed") current.processed += 1;
      if (event.status === "failed") current.failed += 1;
      sourceMap.set(identifier, current);
    }

    return jsonResponse({
      connection: connection ?? null,
      empreendimentos: empreendimentos ?? [],
      summary: {
        total: events?.length ?? 0,
        processed: (events ?? []).filter((event) => event.status === "processed").length,
        failed: (events ?? []).filter((event) => event.status === "failed").length,
      },
      sources: Array.from(sourceMap.values()),
      recentEvents: (events ?? []).slice(0, 10),
    });
  });
});
