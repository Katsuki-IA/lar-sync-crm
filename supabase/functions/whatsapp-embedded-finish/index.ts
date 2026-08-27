import {
  createSupabaseAdmin,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import {
  consumeOnboardingSession,
  encryptSecret,
  assertWhatsAppConnectionAllowed,
  getAuthorizedWhatsAppTarget,
  getWhatsAppConfig,
  graphRequest,
  randomRegistrationPin,
} from "../_shared/whatsapp-embedded.ts";

type FinishInput = {
  empresaId?: unknown;
  sessionId?: string;
  code?: string;
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
};

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string };
};

type DebugTokenResponse = {
  data?: {
    is_valid?: boolean;
    app_id?: string;
    expires_at?: number;
    data_access_expires_at?: number;
  };
};

type PhoneNumber = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
  status?: string;
};

function requireId(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/u.test(normalized)) throw new Error(`${label} inválido retornado pela Meta`);
  return normalized;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const body = (await req.json()) as FinishInput;
    const { userId, idEmpresa } = await getAuthorizedWhatsAppTarget(req, body.empresaId);
    await assertWhatsAppConnectionAllowed(idEmpresa);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^[0-9a-f-]{36}$/iu.test(sessionId)) throw new Error("Sessão de conexão inválida");
    if (!code) throw new Error("Código de autorização não retornado pela Meta");

    const wabaId = requireId(body.wabaId, "WABA ID");
    const phoneNumberId = requireId(body.phoneNumberId, "Phone Number ID");
    const businessId = body.businessId ? requireId(body.businessId, "Business ID") : null;
    const config = getWhatsAppConfig(true);

    await consumeOnboardingSession({ sessionId, idEmpresa, userId });

    const tokenUrl = new URL(
      `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`,
    );
    tokenUrl.searchParams.set("client_id", config.appId);
    tokenUrl.searchParams.set("client_secret", config.appSecret);
    tokenUrl.searchParams.set("code", code);
    const tokenResponse = await fetch(tokenUrl);
    const tokenPayload = (await tokenResponse.json()) as TokenResponse;
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      throw new Error(
        tokenPayload.error?.message ?? "Não foi possível concluir a autorização Meta",
      );
    }
    const businessToken = tokenPayload.access_token;

    const appAccessToken = `${config.appId}|${config.appSecret}`;
    const debug = await graphRequest<DebugTokenResponse>(
      config,
      `debug_token?input_token=${encodeURIComponent(businessToken)}`,
      appAccessToken,
    );
    if (!debug.data?.is_valid || debug.data.app_id !== config.appId) {
      throw new Error("A Meta retornou um token inválido para este aplicativo");
    }

    const phoneNumbers = await graphRequest<{ data?: PhoneNumber[] }>(
      config,
      `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,status&limit=100`,
      businessToken,
    );
    const phone = phoneNumbers.data?.find((item) => item.id === phoneNumberId);
    if (!phone) throw new Error("O número selecionado não pertence à conta WhatsApp retornada");

    const waba = await graphRequest<{ id: string; name?: string }>(
      config,
      `${wabaId}?fields=id,name`,
      businessToken,
    );
    if (waba.id !== wabaId) throw new Error("Conta WhatsApp retornada pela Meta é incompatível");

    const supabaseAdmin = createSupabaseAdmin();
    const { data: existingOwner, error: ownerError } = await supabaseAdmin
      .from("crm_whatsapp_connections")
      .select("id_empresa")
      .eq("waba_id", wabaId)
      .neq("status", "disconnected")
      .neq("id_empresa", idEmpresa)
      .maybeSingle();
    if (ownerError) throw new Error(ownerError.message);
    if (existingOwner) throw new Error("Esta conta WhatsApp já está conectada a outra empresa");

    await graphRequest<{ success: boolean }>(config, `${wabaId}/subscribed_apps`, businessToken, {
      method: "POST",
    });

    const registrationPin = randomRegistrationPin();
    await graphRequest<{ success: boolean }>(config, `${phoneNumberId}/register`, businessToken, {
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", pin: registrationPin }),
    });

    const accessTokenCiphertext = await encryptSecret(businessToken, config.encryptionKey);
    const pinCiphertext = await encryptSecret(registrationPin, config.encryptionKey);
    const tokenExpiresAt = debug.data.expires_at
      ? new Date(debug.data.expires_at * 1000).toISOString()
      : null;
    const now = new Date().toISOString();

    const { data: connection, error: connectionError } = await supabaseAdmin
      .from("crm_whatsapp_connections")
      .upsert(
        {
          id_empresa: idEmpresa,
          business_id: businessId,
          waba_id: wabaId,
          business_name: waba.name ?? null,
          access_token_ciphertext: accessTokenCiphertext,
          registration_pin_ciphertext: pinCiphertext,
          token_expires_at: tokenExpiresAt,
          status: "connected",
          activation_status: "test",
          webhook_subscribed: true,
          phone_registered: true,
          connected_by: userId,
          connected_at: now,
          disconnected_at: null,
          last_health_check_at: now,
          last_error: null,
          updated_at: now,
        },
        { onConflict: "id_empresa" },
      )
      .select("id")
      .single();
    if (connectionError) throw new Error(connectionError.message);

    const { error: deactivateError } = await supabaseAdmin
      .from("crm_whatsapp_phone_numbers")
      .update({ active: false, updated_at: now })
      .eq("id_empresa", idEmpresa)
      .neq("phone_number_id", phoneNumberId);
    if (deactivateError) throw new Error(deactivateError.message);

    const { error: phoneError } = await supabaseAdmin.from("crm_whatsapp_phone_numbers").upsert(
      {
        connection_id: connection.id,
        id_empresa: idEmpresa,
        phone_number_id: phoneNumberId,
        display_phone_number: phone.display_phone_number ?? null,
        verified_name: phone.verified_name ?? null,
        quality_rating: phone.quality_rating ?? null,
        code_verification_status: phone.code_verification_status ?? null,
        name_status: phone.name_status ?? null,
        platform_status: phone.status ?? null,
        active: true,
        updated_at: now,
      },
      { onConflict: "id_empresa,phone_number_id" },
    );
    if (phoneError) throw new Error(phoneError.message);

    return jsonResponse({ ok: true, activationStatus: "test" });
  });
});
