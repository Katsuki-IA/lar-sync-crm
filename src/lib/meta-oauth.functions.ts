import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const META_APP_ID = "1267473975460487";
export const META_REDIRECT_URI = "https://lar-sync-crm.lovable.app/integracoes";
export const META_SCOPES = "leads_retrieval,pages_manage_ads,pages_read_engagement";

export const exchangeMetaCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { code: string }) => {
    if (!data?.code || typeof data.code !== "string") {
      throw new Error("Código de autorização ausente");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const appId = META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) throw new Error("META_APP_SECRET não configurado");

    // 1) Trocar code por access_token (short-lived)
    const tokenUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("redirect_uri", META_REDIRECT_URI);
    tokenUrl.searchParams.set("code", data.code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      console.error("Meta token exchange error", tokenJson);
      throw new Error(tokenJson?.error?.message ?? "Falha ao obter token do Meta");
    }
    const shortToken: string = tokenJson.access_token;

    // 2) Trocar por long-lived token (60 dias)
    const longUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", appId);
    longUrl.searchParams.set("client_secret", appSecret);
    longUrl.searchParams.set("fb_exchange_token", shortToken);

    const longRes = await fetch(longUrl.toString());
    const longJson = await longRes.json();
    const accessToken: string = longJson?.access_token ?? shortToken;

    // 3) Buscar informações do usuário
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`,
    );
    const me = await meRes.json();
    if (!meRes.ok || !me?.id) {
      console.error("Meta /me error", me);
      throw new Error("Não foi possível obter dados do usuário Meta");
    }

    // 4) Descobrir id_empresa do usuário logado
    const { supabase, userId } = context;
    const { data: crmUser, error: crmErr } = await supabase
      .from("crm_users")
      .select("id_empresa")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (crmErr) throw new Error(crmErr.message);
    if (!crmUser?.id_empresa) throw new Error("Usuário sem empresa vinculada");

    // 5) Desativar conexões anteriores e inserir nova
    await supabase
      .from("crm_meta_connections")
      .update({ active: false })
      .eq("id_empresa", crmUser.id_empresa);

    const { data: inserted, error: insertErr } = await supabase
      .from("crm_meta_connections")
      .insert({
        id_empresa: crmUser.id_empresa,
        user_id_meta: me.id,
        user_name: me.name ?? null,
        user_access_token: accessToken,
        connected_at: new Date().toISOString(),
        active: true,
      })
      .select("id,user_name,user_id_meta")
      .single();
    if (insertErr) throw new Error(insertErr.message);

    return { ok: true as const, connection: inserted };
  });