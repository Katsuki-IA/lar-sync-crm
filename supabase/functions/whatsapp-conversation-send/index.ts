import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CrmUserRow = {
  id: string;
  id_empresa: number | null;
  role: "super_admin" | "manager" | "agent";
};

type LeadRow = {
  id: number;
  id_empresa: number;
  nome: string;
  numero: string | null;
  wa_user_id: string | null;
  wa_username: string | null;
  wa_identity_id: string | null;
  conversation_key: string | null;
  legacy_conversation_key: string | null;
  atendimento_humano: boolean | null;
  wa_conversation_assigned_to: string | null;
};

type IdentityRow = {
  id: string;
  telefone: string | null;
  wa_user_id: string | null;
  username: string | null;
  business_phone_number_id: string | null;
  conversation_key: string | null;
  legacy_conversation_key: string | null;
};

type MetaSendResult = {
  contacts?: Array<{ input?: string; wa_id?: string }>;
  messages?: Array<{ id?: string; message_status?: string }>;
  error?: { code?: number; message?: string };
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredInteger(value: unknown, label: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} inválido`);
  return parsed;
}

function requiredText(value: unknown, label: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} obrigatório`);
  if (text.length > maxLength)
    throw new Error(`${label} deve ter no máximo ${maxLength} caracteres`);
  return text;
}

function normalizePhone(value: string | null | undefined) {
  return value?.replace(/\D/gu, "") || null;
}

function normalizeRecipient(value: string | null | undefined) {
  const recipient = value?.trim() ?? "";
  if (
    !recipient ||
    recipient.length > 255 ||
    Array.from(recipient).some((character) => character.charCodeAt(0) <= 32)
  ) {
    return null;
  }
  return recipient;
}

function bytesFromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function decryptSecret(value: string, secret: string) {
  const [version, encodedIv, encodedPayload] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedPayload) {
    throw new Error("Credencial criptografada do WhatsApp inválida");
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromBase64(encodedIv) },
    key,
    bytesFromBase64(encodedPayload),
  );
  return new TextDecoder().decode(decrypted);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey)
      throw new Error("Configuração interna do Supabase ausente");

    const authorization = req.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) throw new Error("Usuário não autenticado");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authorization.slice("Bearer ".length);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user?.id) throw new Error("Sessão inválida");

    const { data: crmUserData, error: crmUserError } = await admin
      .from("crm_users")
      .select("id,id_empresa,role")
      .eq("auth_user_id", authData.user.id)
      .eq("active", true)
      .maybeSingle();
    if (crmUserError) throw new Error(crmUserError.message);
    if (!crmUserData) throw new Error("Usuário ativo do CRM não encontrado");
    const crmUser = crmUserData as CrmUserRow;

    const input = (await req.json()) as Record<string, unknown>;
    const leadId = requiredInteger(input.leadId, "Conversa");
    const text = requiredText(input.text, "Mensagem", 4096);
    const clientMessageId = requiredText(input.clientMessageId, "Identificador da mensagem", 100);

    const { data: previous } = await admin
      .from("wa_messages")
      .select("message_id,status_current")
      .eq("client_message_id", clientMessageId)
      .not("message_id", "is", null)
      .maybeSingle();
    if (previous?.message_id) {
      return jsonResponse({
        ok: true,
        messageId: previous.message_id,
        status: previous.status_current,
        duplicate: true,
      });
    }

    const { data: leadData, error: leadError } = await admin
      .from("lead")
      .select(
        "id,id_empresa,nome,numero,wa_user_id,wa_username,wa_identity_id,conversation_key,legacy_conversation_key,atendimento_humano,wa_conversation_assigned_to",
      )
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) throw new Error(leadError.message);
    if (!leadData) throw new Error("Conversa não encontrada");
    const lead = leadData as LeadRow;

    if (crmUser.role !== "super_admin" && crmUser.id_empresa !== lead.id_empresa) {
      throw new Error("Sem permissão para enviar mensagens nesta empresa");
    }
    if (!lead.atendimento_humano) {
      throw new Error("Assuma a conversa antes de enviar uma mensagem");
    }
    if (lead.wa_conversation_assigned_to !== crmUser.id) {
      throw new Error("Esta conversa está atribuída a outro atendente");
    }

    let identity: IdentityRow | null = null;
    if (lead.wa_identity_id) {
      const { data, error } = await admin
        .from("wa_contact_identities")
        .select(
          "id,telefone,wa_user_id,username,business_phone_number_id,conversation_key,legacy_conversation_key",
        )
        .eq("id", lead.wa_identity_id)
        .eq("id_empresa", lead.id_empresa)
        .maybeSingle();
      if (error) throw new Error(error.message);
      identity = data as IdentityRow | null;
    }

    const recipient =
      normalizeRecipient(identity?.wa_user_id) ??
      normalizeRecipient(lead.wa_user_id) ??
      normalizePhone(identity?.telefone) ??
      normalizePhone(lead.numero);
    if (!recipient) {
      throw new Error("A conversa não possui uma identidade WhatsApp válida para envio");
    }

    const [
      { data: legacyCredentials, error: legacyError },
      { data: connection, error: connectionError },
    ] = await Promise.all([
      admin
        .from("credentials")
        .select("whatsapp_access_token,whatsapp_business_id")
        .eq("id_empresa", lead.id_empresa)
        .limit(1)
        .maybeSingle(),
      admin
        .from("crm_whatsapp_connections")
        .select("id,access_token_ciphertext")
        .eq("id_empresa", lead.id_empresa)
        .eq("status", "connected")
        .maybeSingle(),
    ]);
    if (legacyError) throw new Error(legacyError.message);
    if (connectionError) throw new Error(connectionError.message);

    let phoneNumberId: string | null = null;
    let accessToken: string | null = null;
    let fromWaId: string | null = null;
    const preferredPhoneNumberId = identity?.business_phone_number_id?.trim() || null;

    if (connection) {
      let phonesQuery = admin
        .from("crm_whatsapp_phone_numbers")
        .select("phone_number_id,display_phone_number")
        .eq("connection_id", connection.id)
        .eq("active", true);
      if (preferredPhoneNumberId)
        phonesQuery = phonesQuery.eq("phone_number_id", preferredPhoneNumberId);
      const phonesResult = await phonesQuery.order("created_at").limit(1);
      if (phonesResult.error) throw new Error(phonesResult.error.message);
      let phones = phonesResult.data;

      if (!phones?.length && preferredPhoneNumberId) {
        const fallback = await admin
          .from("crm_whatsapp_phone_numbers")
          .select("phone_number_id,display_phone_number")
          .eq("connection_id", connection.id)
          .eq("active", true)
          .order("created_at")
          .limit(1);
        if (fallback.error) throw new Error(fallback.error.message);
        phones = fallback.data;
      }

      const phone = phones?.[0];
      const encryptionKey = Deno.env.get("META_WHATSAPP_TOKEN_ENCRYPTION_KEY") ?? "";
      if (phone && encryptionKey) {
        phoneNumberId = phone.phone_number_id;
        fromWaId = normalizePhone(phone.display_phone_number) ?? phone.phone_number_id;
        accessToken = await decryptSecret(connection.access_token_ciphertext, encryptionKey);
      }
    }

    if (!phoneNumberId || !accessToken) {
      phoneNumberId = legacyCredentials?.whatsapp_business_id?.trim() || null;
      accessToken = legacyCredentials?.whatsapp_access_token?.trim() || null;
      fromWaId = phoneNumberId;
    }
    if (!phoneNumberId || !accessToken) {
      throw new Error("Credenciais de envio do WhatsApp não configuradas para esta empresa");
    }

    const graphVersion = Deno.env.get("META_WHATSAPP_GRAPH_VERSION") ?? "v26.0";
    const requestPayload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: { preview_url: false, body: text },
    };
    const graphResponse = await fetch(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      },
    );
    const graphResult = (await graphResponse.json()) as MetaSendResult;
    if (!graphResponse.ok || graphResult.error) {
      const code = graphResult.error?.code ? ` (código ${graphResult.error.code})` : "";
      throw new Error(`${graphResult.error?.message ?? "Falha ao enviar pela Meta"}${code}`);
    }

    const messageId = graphResult.messages?.[0]?.id;
    if (!messageId) throw new Error("A Meta não retornou o identificador da mensagem");
    const now = new Date().toISOString();
    const status = graphResult.messages?.[0]?.message_status ?? "accepted";
    const resolvedRecipient = graphResult.contacts?.[0]?.wa_id ?? recipient;

    const { error: transportError } = await admin.from("wa_messages").upsert(
      {
        phone_number_id: phoneNumberId,
        message_id: messageId,
        client_message_id: clientMessageId,
        direction: "outbound",
        from_wa_id: fromWaId,
        to_wa_id: resolvedRecipient,
        to_user_id: identity?.wa_user_id ?? lead.wa_user_id,
        to_username: identity?.username ?? lead.wa_username,
        type: "text",
        text_body: text,
        timestamp_meta: now,
        sent_at: now,
        status_current: status,
        status_last_at: now,
        tenant_id: lead.id_empresa,
        wa_identity_id: lead.wa_identity_id,
        conversation_key: lead.conversation_key ?? identity?.conversation_key,
        legacy_conversation_key: lead.legacy_conversation_key ?? identity?.legacy_conversation_key,
        raw: { source: "hub_human", request: requestPayload, response: graphResult },
        updated_at: now,
      },
      { onConflict: "phone_number_id,message_id" },
    );
    if (transportError)
      throw new Error(
        `Mensagem enviada, mas o histórico técnico falhou: ${transportError.message}`,
      );

    const phone = normalizePhone(identity?.telefone) ?? normalizePhone(lead.numero);
    const { error: historyError } = await admin.from("n8n_chat_conversas").insert({
      numero: phone ?? recipient,
      telefone: phone,
      type: "ai",
      message: text,
      time: now,
      id_empresa: lead.id_empresa,
      wa_identity_id: lead.wa_identity_id,
      wa_user_id: identity?.wa_user_id ?? lead.wa_user_id,
      wa_username: identity?.username ?? lead.wa_username,
      conversation_key: lead.conversation_key ?? identity?.conversation_key,
      legacy_conversation_key: lead.legacy_conversation_key ?? identity?.legacy_conversation_key,
    });
    if (historyError)
      throw new Error(
        `Mensagem enviada, mas o histórico da conversa falhou: ${historyError.message}`,
      );

    const { error: leadUpdateError } = await admin
      .from("lead")
      .update({ last_mesage: text, last_message_timestamp: now, updated_at: now })
      .eq("id", lead.id)
      .eq("wa_conversation_assigned_to", crmUser.id);
    if (leadUpdateError)
      throw new Error(
        `Mensagem enviada, mas a conversa não foi atualizada: ${leadUpdateError.message}`,
      );

    return jsonResponse({ ok: true, messageId, status });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Falha ao enviar mensagem" },
      400,
    );
  }
});
