import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  getMetaConfig,
  handleOptions,
  jsonResponse,
  syncMetaFormsForConnection,
  verifySignedState,
  withErrorHandling,
} from "../_shared/meta.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { code, state } = (await req.json()) as { code?: string; state?: string };
    if (!code || typeof code !== "string") throw new Error("Código de autorização ausente");
    if (!state || typeof state !== "string") throw new Error("State OAuth ausente");

    const { appId, appSecret, redirectUri, graphVersion } = getMetaConfig();
    const { userId, crmUser } = await getAuthorizedCrmUser(req);
    await verifySignedState(state, userId, crmUser.id_empresa, appSecret);

    const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      console.error("Meta token exchange error", tokenJson);
      throw new Error(tokenJson?.error?.message ?? "Falha ao obter token do Meta");
    }

    const longUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", appId);
    longUrl.searchParams.set("client_secret", appSecret);
    longUrl.searchParams.set("fb_exchange_token", tokenJson.access_token);

    const longRes = await fetch(longUrl.toString());
    const longJson = await longRes.json();
    const accessToken: string = longJson?.access_token ?? tokenJson.access_token;

    const meUrl = new URL(`https://graph.facebook.com/${graphVersion}/me`);
    meUrl.searchParams.set("fields", "id,name");
    meUrl.searchParams.set("access_token", accessToken);
    const meRes = await fetch(meUrl.toString());
    const metaUser = await meRes.json();
    if (!meRes.ok || !metaUser?.id) {
      console.error("Meta /me error", metaUser);
      throw new Error("Não foi possível obter dados do usuário Meta");
    }

    const supabaseAdmin = createSupabaseAdmin();
    const { data: connection, error: connectionError } = await supabaseAdmin
      .from("crm_meta_connections")
      .upsert(
        {
          id_empresa: crmUser.id_empresa,
          user_id_meta: metaUser.id,
          user_name: metaUser.name ?? null,
          user_access_token: accessToken,
          connected_at: new Date().toISOString(),
          active: true,
        },
        { onConflict: "id_empresa" },
      )
      .select("id,user_name,user_id_meta,connected_at,active")
      .single();

    if (connectionError) throw new Error(connectionError.message);

    const sync = await syncMetaFormsForConnection({
      idEmpresa: crmUser.id_empresa,
      connectionId: connection.id,
      userAccessToken: accessToken,
      graphVersion,
    });

    return jsonResponse({ ok: true, connection, sync });
  });
});
