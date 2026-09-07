import {
  createSupabaseAdmin,
  getMetaConfig,
  jsonResponse,
  refreshMetaPageAccessTokens,
  withErrorHandling,
} from "../_shared/meta.ts";
import { checkMetaTokenPermissions } from "../_shared/meta-attribution.ts";
import { recoverMetaLeadsForForm } from "../_shared/meta-recovery.ts";

type MetaConnection = {
  id: string;
  id_empresa: number;
  user_access_token: string;
  connected_at: string | null;
  recovery_backfill_completed_at: string | null;
  last_error: string | null;
};

function safeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

async function writeEvent(args: {
  supabaseAdmin: ReturnType<typeof createSupabaseAdmin>;
  connection: MetaConnection;
  eventType: string;
  message: string;
  details?: Record<string, unknown>;
}) {
  const { error } = await args.supabaseAdmin.from("crm_meta_connection_events").insert({
    id_empresa: args.connection.id_empresa,
    connection_id: args.connection.id,
    event_type: args.eventType,
    message: args.message.slice(0, 2000),
    details: args.details ?? {},
  });
  if (error) console.error("Falha ao registrar evento da conexão Meta", error);
}

Deno.serve((req) =>
  withErrorHandling(async () => {
    if (req.method !== "POST") return jsonResponse({ error: "Método não permitido" }, 405);
    const expectedSecret = Deno.env.get("META_HEALTH_CRON_SECRET") ?? "";
    const providedSecret = req.headers.get("x-meta-health-secret") ?? "";
    if (!expectedSecret || !safeEqual(providedSecret, expectedSecret)) {
      return jsonResponse({ error: "Não autorizado" }, 401);
    }

    const { appId, appSecret, graphVersion } = getMetaConfig();
    const supabaseAdmin = createSupabaseAdmin();
    const { data: connections, error: connectionsError } = await supabaseAdmin
      .from("crm_meta_connections")
      .select(
        "id,id_empresa,user_access_token,connected_at,recovery_backfill_completed_at,last_error",
      )
      .eq("active", true);
    if (connectionsError) throw new Error(connectionsError.message);

    const summary = { checked: 0, healthy: 0, degraded: 0, errors: 0, recovered: 0 };
    for (const connection of (connections ?? []) as MetaConnection[]) {
      summary.checked += 1;
      const permission = await checkMetaTokenPermissions({
        appId,
        appSecret,
        graphVersion,
        userAccessToken: connection.user_access_token,
      });
      const problems: string[] = [];
      if (!permission.isValid) {
        problems.push(permission.error ?? "Token Meta inválido ou expirado");
      } else if (!permission.scopes.includes("leads_retrieval")) {
        problems.push("A conexão Meta perdeu a permissão leads_retrieval.");
      }
      if (permission.isValid && !permission.hasAdsRead) {
        problems.push(
          "A conexão Meta não possui ads_read; os nomes de anúncios não serão atualizados.",
        );
      }

      let recovered = 0;
      let failedRecoveries = 0;
      let userTokenFallbackAttempts = 0;
      let userTokenFallbacks = 0;
      let hadConfiguredForms = false;
      let needsInitialBackfill = false;
      if (permission.isValid && permission.scopes.includes("leads_retrieval")) {
        const { data: forms, error: formsError } = await supabaseAdmin
          .from("crm_meta_forms")
          .select("form_id,page_id,page_access_token,id_empreendimento,id_funnel")
          .eq("id_empresa", connection.id_empresa)
          .eq("connection_id", connection.id)
          .eq("active", true)
          .eq("webhook_subscribed", true)
          .not("id_empreendimento", "is", null)
          .not("id_funnel", "is", null)
          .limit(50);
        if (formsError) {
          problems.push(formsError.message);
        } else {
          hadConfiguredForms = (forms ?? []).length > 0;
          needsInitialBackfill = !connection.recovery_backfill_completed_at;
          const since = needsInitialBackfill ? hoursAgo(72) : hoursAgo(1);
          let refreshedPageTokens: Record<string, string> = {};
          try {
            const tokenRefresh = await refreshMetaPageAccessTokens({
              userAccessToken: connection.user_access_token,
              graphVersion,
              pageIds: (forms ?? []).map((form) => form.page_id),
            });
            refreshedPageTokens = tokenRefresh.tokens;
            for (const [pageId, pageAccessToken] of Object.entries(refreshedPageTokens)) {
              const { error: pageTokenUpdateError } = await supabaseAdmin
                .from("crm_meta_forms")
                .update({ page_access_token: pageAccessToken })
                .eq("id_empresa", connection.id_empresa)
                .eq("connection_id", connection.id)
                .eq("page_id", pageId);
              if (pageTokenUpdateError) problems.push(pageTokenUpdateError.message);
            }
          } catch (error) {
            console.error("Falha ao renovar tokens das Paginas Meta", {
              connectionId: connection.id,
              idEmpresa: connection.id_empresa,
              error,
            });
          }

          for (const form of forms ?? []) {
            const recovery = await recoverMetaLeadsForForm({
              supabaseAdmin,
              idEmpresa: connection.id_empresa,
              connectionId: connection.id,
              userAccessToken: connection.user_access_token,
              graphVersion,
              form: {
                ...form,
                page_access_token: refreshedPageTokens[form.page_id] ?? form.page_access_token,
              },
              since,
              until: new Date(),
              limit: 500,
            });
            recovered += recovery.recovered;
            failedRecoveries += recovery.failed.length;
            if (recovery.attemptedUserTokenFallback) userTokenFallbackAttempts += 1;
            if (recovery.usedUserTokenFallback) userTokenFallbacks += 1;
            for (const failed of recovery.failed)
              problems.push(`${failed.formId}: ${failed.message}`);
          }
        }
      }

      summary.recovered += recovered;
      const isTokenFailure = !permission.isValid || !permission.scopes.includes("leads_retrieval");
      const healthStatus = isTokenFailure ? "error" : problems.length > 0 ? "degraded" : "healthy";
      const lastError = problems.length > 0 ? problems.join(" | ").slice(0, 2000) : null;
      const update: Record<string, unknown> = {
        health_status: healthStatus,
        last_health_check_at: new Date().toISOString(),
        last_error: lastError,
        token_last_validated_at: new Date().toISOString(),
        token_validation_error: permission.isValid
          ? null
          : (permission.error ?? "Token Meta inválido"),
      };
      if (permission.expiresAt) update.token_expires_at = permission.expiresAt;
      if (permission.dataAccessExpiresAt) {
        update.token_data_access_expires_at = permission.dataAccessExpiresAt;
      }
      if (needsInitialBackfill && hadConfiguredForms && failedRecoveries === 0 && !isTokenFailure) {
        update.recovery_backfill_completed_at = new Date().toISOString();
      }
      const { error: updateError } = await supabaseAdmin
        .from("crm_meta_connections")
        .update(update)
        .eq("id", connection.id)
        .eq("id_empresa", connection.id_empresa);
      if (updateError) throw new Error(updateError.message);

      if (healthStatus === "healthy") summary.healthy += 1;
      else if (healthStatus === "degraded") summary.degraded += 1;
      else summary.errors += 1;
      if (lastError && lastError !== connection.last_error) {
        await writeEvent({
          supabaseAdmin,
          connection,
          eventType: isTokenFailure
            ? "token_invalid"
            : failedRecoveries > 0
              ? "recovery_failed"
              : "degraded",
          message: lastError,
          details: {
            scopes: permission.scopes,
            recovered,
            failedRecoveries,
            userTokenFallbackAttempts,
            userTokenFallbacks,
          },
        });
      }
    }

    return jsonResponse({ ok: true, ...summary });
  }),
);
