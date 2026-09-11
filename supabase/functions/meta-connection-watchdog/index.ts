import {
  createSupabaseAdmin,
  ensureMetaPageLeadgenSubscription,
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
  health_status: string | null;
  last_error: string | null;
  token_validation_error: string | null;
};

type WatchdogMode = "health" | "daily_recovery";

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

function getRecoverySince(lastRecoveredAt: string | null) {
  const lastRecovery = lastRecoveredAt ? new Date(lastRecoveredAt) : null;
  if (lastRecovery && !Number.isNaN(lastRecovery.getTime())) {
    // Pequena sobreposicao protege contra atrasos de entrega e diferencas de relogio.
    return new Date(lastRecovery.getTime() - 2 * 60 * 60 * 1000);
  }
  return hoursAgo(72);
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

    const requestBody = (await req.json().catch(() => ({}))) as { mode?: string };
    const mode: WatchdogMode = requestBody.mode === "daily_recovery" ? "daily_recovery" : "health";
    const runRecovery = mode === "daily_recovery";

    const { appId, appSecret, graphVersion } = getMetaConfig();
    const supabaseAdmin = createSupabaseAdmin();
    const { data: hubCredentials, error: hubCredentialsError } = await supabaseAdmin
      .from("credentials")
      .select("id_empresa")
      .eq("default_crm", "hub")
      .not("id_empresa", "is", null);
    if (hubCredentialsError) throw new Error(hubCredentialsError.message);

    const hubCompanyIds = Array.from(
      new Set(
        (hubCredentials ?? []).map((item) => Number(item.id_empresa)).filter(Number.isFinite),
      ),
    );
    let connections: MetaConnection[] = [];
    if (hubCompanyIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("crm_meta_connections")
        .select(
          "id,id_empresa,user_access_token,connected_at,recovery_backfill_completed_at,health_status,last_error,token_validation_error",
        )
        .eq("active", true)
        .in("id_empresa", hubCompanyIds);
      if (error) throw new Error(error.message);
      connections = (data ?? []) as MetaConnection[];
    }

    const summary = {
      mode,
      checked: 0,
      healthy: 0,
      degraded: 0,
      errors: 0,
      recovered: 0,
    };
    for (const connection of connections) {
      summary.checked += 1;
      const permission = await checkMetaTokenPermissions({
        appId,
        appSecret,
        graphVersion,
        userAccessToken: connection.user_access_token,
      });
      const problems: string[] = [];
      if (!permission.isValid) {
        problems.push(
          permission.rateLimited
            ? "A Meta limitou temporariamente as chamadas do aplicativo."
            : (permission.error ?? "Token Meta inválido ou expirado"),
        );
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
      let recoveryWarnings = 0;
      let userTokenFallbackAttempts = 0;
      let userTokenFallbacks = 0;
      let hadConfiguredForms = false;
      let needsInitialBackfill = false;
      if (runRecovery && permission.isValid && permission.scopes.includes("leads_retrieval")) {
        const { data: forms, error: formsError } = await supabaseAdmin
          .from("crm_meta_forms")
          .select(
            "form_id,page_id,page_name,page_access_token,id_empreendimento,id_funnel,last_recovered_at",
          )
          .eq("id_empresa", connection.id_empresa)
          .eq("connection_id", connection.id)
          .eq("active", true)
          .not("id_empreendimento", "is", null)
          .not("id_funnel", "is", null)
          .limit(50);
        if (formsError) {
          problems.push(formsError.message);
        } else {
          hadConfiguredForms = (forms ?? []).length > 0;
          needsInitialBackfill = !connection.recovery_backfill_completed_at;
          let refreshedPageTokens: Record<string, string> = {};
          try {
            const tokenRefresh = await refreshMetaPageAccessTokens({
              userAccessToken: connection.user_access_token,
              graphVersion,
              pageIds: (forms ?? []).map((form) => form.page_id),
            });
            refreshedPageTokens = tokenRefresh.tokens;
            const formPageNames = new Map(
              (forms ?? []).map((form) => [form.page_id, form.page_name ?? form.page_id]),
            );
            for (const pageId of tokenRefresh.missingPageIds) {
              const message = `Página ${formPageNames.get(pageId) ?? pageId} não foi retornada pela Meta. Reautorize o acesso à página.`;
              problems.push(message);
              const { error: missingPageUpdateError } = await supabaseAdmin
                .from("crm_meta_forms")
                .update({
                  webhook_subscribed: false,
                  webhook_checked_at: new Date().toISOString(),
                  webhook_error: message,
                })
                .eq("id_empresa", connection.id_empresa)
                .eq("connection_id", connection.id)
                .eq("page_id", pageId);
              if (missingPageUpdateError) problems.push(missingPageUpdateError.message);
            }
            for (const [pageId, pageAccessToken] of Object.entries(refreshedPageTokens)) {
              const { error: pageTokenUpdateError } = await supabaseAdmin
                .from("crm_meta_forms")
                .update({ page_access_token: pageAccessToken })
                .eq("id_empresa", connection.id_empresa)
                .eq("connection_id", connection.id)
                .eq("page_id", pageId);
              if (pageTokenUpdateError) problems.push(pageTokenUpdateError.message);

              try {
                await ensureMetaPageLeadgenSubscription({
                  pageId,
                  pageAccessToken,
                  graphVersion,
                });
                const { error: subscriptionUpdateError } = await supabaseAdmin
                  .from("crm_meta_forms")
                  .update({
                    webhook_subscribed: true,
                    webhook_checked_at: new Date().toISOString(),
                    webhook_error: null,
                  })
                  .eq("id_empresa", connection.id_empresa)
                  .eq("connection_id", connection.id)
                  .eq("page_id", pageId);
                if (subscriptionUpdateError) problems.push(subscriptionUpdateError.message);
              } catch (error) {
                const message = `Página ${formPageNames.get(pageId) ?? pageId}: falha ao renovar webhook leadgen: ${
                  error instanceof Error ? error.message : "erro desconhecido"
                }`;
                problems.push(message);
                const { error: subscriptionUpdateError } = await supabaseAdmin
                  .from("crm_meta_forms")
                  .update({
                    webhook_subscribed: false,
                    webhook_checked_at: new Date().toISOString(),
                    webhook_error: message,
                  })
                  .eq("id_empresa", connection.id_empresa)
                  .eq("connection_id", connection.id)
                  .eq("page_id", pageId);
                if (subscriptionUpdateError) problems.push(subscriptionUpdateError.message);
              }
            }
          } catch (error) {
            const message = `Falha ao renovar tokens das Páginas Meta: ${
              error instanceof Error ? error.message : "erro desconhecido"
            }`;
            problems.push(message);
            console.error(message, {
              connectionId: connection.id,
              idEmpresa: connection.id_empresa,
              error,
            });
          }

          for (const form of forms ?? []) {
            const since = getRecoverySince(form.last_recovered_at);
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
            recoveryWarnings += recovery.warnings.length;
            if (recovery.attemptedUserTokenFallback) userTokenFallbackAttempts += 1;
            if (recovery.usedUserTokenFallback) userTokenFallbacks += 1;
            for (const failed of recovery.failed)
              problems.push(`${failed.formId}: ${failed.message}`);
            for (const warning of recovery.warnings) {
              problems.push(
                `${warning.formId}${warning.leadId ? ` lead ${warning.leadId}` : ""}: ${warning.message}`,
              );
            }
            if (recovery.rateLimited) {
              problems.push(
                "A recuperação diária foi interrompida porque a Meta sinalizou limite de chamadas.",
              );
              break;
            }
          }
        }
      }

      if (
        !runRecovery &&
        permission.isValid &&
        permission.scopes.includes("leads_retrieval") &&
        problems.length === 0 &&
        connection.health_status !== "healthy" &&
        !connection.token_validation_error &&
        connection.last_error
      ) {
        // A validacao leve nao deve apagar uma falha de formulario/webhook antes
        // que a recuperacao diaria confirme que o acesso voltou ao normal.
        problems.push(connection.last_error);
      }

      summary.recovered += recovered;
      const isTokenFailure =
        (!permission.isValid && !permission.rateLimited) ||
        (permission.isValid && !permission.scopes.includes("leads_retrieval"));
      const healthStatus = isTokenFailure ? "error" : problems.length > 0 ? "degraded" : "healthy";
      const lastError = problems.length > 0 ? problems.join(" | ").slice(0, 2000) : null;
      const update: Record<string, unknown> = {
        health_status: healthStatus,
        last_health_check_at: new Date().toISOString(),
        last_error: lastError,
        token_last_validated_at: new Date().toISOString(),
        token_validation_error: permission.rateLimited
          ? null
          : permission.isValid
            ? null
            : (permission.error ?? "Token Meta inválido"),
      };
      if (permission.expiresAt) update.token_expires_at = permission.expiresAt;
      if (permission.dataAccessExpiresAt) {
        update.token_data_access_expires_at = permission.dataAccessExpiresAt;
      }
      if (
        runRecovery &&
        needsInitialBackfill &&
        hadConfiguredForms &&
        failedRecoveries === 0 &&
        !isTokenFailure
      ) {
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
            : failedRecoveries > 0 || recoveryWarnings > 0
              ? "recovery_failed"
              : "degraded",
          message: lastError,
          details: {
            mode,
            scopes: permission.scopes,
            recovered,
            failedRecoveries,
            recoveryWarnings,
            userTokenFallbackAttempts,
            userTokenFallbacks,
          },
        });
      }
    }

    return jsonResponse({ ok: true, ...summary });
  }),
);
