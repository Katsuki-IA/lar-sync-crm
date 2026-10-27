import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import {
  MEDIA_BUCKET,
  mediaPath,
  validateMediaFile,
  validateMediaSignature,
} from "../_shared/conversation-media.ts";
import {
  buildTemplateComponents,
  isAttendanceTemplate,
  templatePreview,
  type ConversationTemplate,
} from "../_shared/conversation-templates.ts";

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
  contacts?: Array<{ input?: string; wa_id?: string; user_id?: string }>;
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

  let deliveryStarted=false;
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
    const listTemplates = input.action === "list_templates";
    const sendTemplate = input.action === "send_template";
    const prepareMedia = input.action === "prepare_media";
    const sendMedia = input.action === "send_media";
    if (input.action && !listTemplates && !sendTemplate && !prepareMedia && !sendMedia)
      throw new Error("Ação inválida");
    let text =
      listTemplates || sendTemplate || prepareMedia || sendMedia
        ? ""
        : requiredText(input.text, "Mensagem", 4096);
    const caption = typeof input.caption === "string" ? input.caption.trim() : "";
    if (sendMedia && caption.length > 1024)
      throw new Error("A legenda deve ter no máximo 1.024 caracteres.");
    const clientMessageId = listTemplates
      ? ""
      : requiredText(input.clientMessageId, "Identificador da mensagem", 100);

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
    const deliveryArgs={p_company:lead.id_empresa,p_lead:lead.id,p_actor:crmUser.id,p_request:clientMessageId,p_body:input};
    const finishDelivery=async(ticket:any)=>{
      if(ticket.state==='sending')return jsonResponse({error:'Resultado incerto ou envio em andamento. Não repita; requer conferência.',deliveryUncertain:true},409);
      const {data,error}=await admin.rpc('hub_delivery_finalize',{p_id:ticket.id,p_token:ticket.claim_token});
      if(error)return jsonResponse({error:'Mensagem enviada; recuperação do histórico pendente.',deliveryUncertain:true},409);
      return jsonResponse(data);
    };
    if(!listTemplates&&!prepareMedia){
      const {data:existing,error}=await admin.rpc('hub_delivery_lookup',deliveryArgs);
      if(error)throw new Error(error.message);
      if(existing)return finishDelivery(existing);
    }
    if (!listTemplates && !lead.atendimento_humano) {
      throw new Error("Assuma a conversa antes de enviar uma mensagem");
    }
    if (!listTemplates && lead.wa_conversation_assigned_to !== crmUser.id) {
      throw new Error("Esta conversa está atribuída a outro atendente");
    }

    if (!listTemplates) {
      const { data: previous, error: previousError } = await admin
        .from("wa_messages")
        .select("message_id,status_current")
        .eq("tenant_id", lead.id_empresa)
        .eq("client_message_id", clientMessageId)
        .not("message_id", "is", null)
        .maybeSingle();
      if (previousError) throw new Error(previousError.message);
      if (previous?.message_id)
        return jsonResponse({
          ok: true,
          messageId: previous.message_id,
          status: previous.status_current,
          duplicate: true,
        });
    }

    if (!listTemplates && !sendTemplate) {
      const { data: windowData, error: windowError } = await admin.rpc(
        "crm_whatsapp_conversation_windows",
        {
          p_id_empresa: lead.id_empresa,
          p_lead_ids: [lead.id],
        },
      );
      if (windowError) throw new Error(windowError.message);
      if (!windowData?.[0]?.window_open) {
        throw new Error(
          "A janela de 24 horas está fechada. Aguarde o lead enviar uma nova mensagem.",
        );
      }
    }

    let attachment: {
      kind: "image" | "document";
      path: string;
      filename: string;
      mime: string;
      size: number;
      url: string;
    } | null = null;
    if (prepareMedia || sendMedia) {
      const filename = requiredText(input.fileName, "Nome do arquivo", 200);
      const mime = requiredText(input.mimeType, "Formato do arquivo", 80);
      const size = Number(input.fileSize);
      const kind = validateMediaFile(filename, mime, size);
      const path = mediaPath(lead.id_empresa, lead.id, crmUser.id, clientMessageId, filename);
      if (prepareMedia) {
        const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
        if (error || !data) throw new Error(error?.message ?? "Falha ao preparar o anexo");
        return jsonResponse({ ok: true, path, token: data.token });
      }
      if (input.storagePath !== path)
        throw new Error("O anexo não pertence a esta conversa ou atendente.");
      const folder = path.slice(0, path.lastIndexOf("/")),
        basename = path.split("/").at(-1)!;
      const { data: files, error: listError } = await admin.storage
        .from(MEDIA_BUCKET)
        .list(folder, { search: basename, limit: 2 });
      const file = files?.find((f) => f.name === basename);
      if (listError || !file)
        throw new Error("Anexo não encontrado. Selecione o arquivo novamente.");
      const actualMime = String(file.metadata?.mimetype ?? "");
      const actualSize = Number(file.metadata?.size);
      validateMediaFile(filename, actualMime, actualSize);
      if (actualMime !== mime || actualSize !== size)
        throw new Error("O tamanho ou formato do anexo diverge do arquivo selecionado.");
      const { data: signed, error: signError } = await admin.storage
        .from(MEDIA_BUCKET)
        .createSignedUrl(path, 3600);
      if (signError || !signed) throw new Error("Falha ao preparar o acesso ao anexo.");
      // Read only the signature; never buffer a large PDF in the Edge runtime.
      const check = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-15" } });
      if (!check.ok || !check.body)
        throw new Error("Não foi possível validar o conteúdo do anexo.");
      const reader = check.body.getReader();
      const prefix = new Uint8Array(16);
      let prefixLength = 0;
      while (prefixLength < prefix.length) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const part = chunk.value.slice(0, prefix.length - prefixLength);
        prefix.set(part, prefixLength);
        prefixLength += part.length;
      }
      await reader.cancel();
      validateMediaSignature(prefix.slice(0, prefixLength), mime);
      attachment = { kind, path, filename, mime, size, url: signed.signedUrl };
      text =
        (kind === "image" ? "[Imagem] " : "[PDF] ") + filename + (caption ? "\n" + caption : "");
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

    // Enquanto o webhook disponibilizar o wa_id, ele continua sendo o destino
    // mais compatível. O BSUID é o fallback para contatos que ocultarem o telefone.
    const recipientPhone = normalizePhone(identity?.telefone) ?? normalizePhone(lead.numero);
    const recipientBsuid =
      normalizeRecipient(identity?.wa_user_id) ?? normalizeRecipient(lead.wa_user_id);
    const recipient = recipientPhone ?? recipientBsuid;
    if (!recipient) {
      throw new Error("A conversa não possui uma identidade WhatsApp válida para envio");
    }

    const [
      { data: legacyCredentials, error: legacyError },
      { data: connection, error: connectionError },
    ] = await Promise.all([
      admin
        .from("credentials")
        .select("whatsapp_access_token,whatsapp_business_id,waba_id")
        .eq("id_empresa", lead.id_empresa)
        .limit(1)
        .maybeSingle(),
      admin
        .from("crm_whatsapp_connections")
        .select("id,access_token_ciphertext,waba_id")
        .eq("id_empresa", lead.id_empresa)
        .eq("status", "connected")
        .maybeSingle(),
    ]);
    if (legacyError) throw new Error(legacyError.message);
    if (connectionError) throw new Error(connectionError.message);

    let phoneNumberId: string | null = null;
    let accessToken: string | null = null;
    let fromWaId: string | null = null;
    let templateWabaId: string | null = null;
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
        templateWabaId = connection.waba_id?.trim() || null;
      }
    }

    if (!phoneNumberId || !accessToken) {
      phoneNumberId = legacyCredentials?.whatsapp_business_id?.trim() || null;
      accessToken = legacyCredentials?.whatsapp_access_token?.trim() || null;
      fromWaId = phoneNumberId;
      templateWabaId = legacyCredentials?.waba_id?.trim() || null;
    }
    if (!phoneNumberId || !accessToken) {
      throw new Error("Credenciais de envio do WhatsApp não configuradas para esta empresa");
    }

    const graphVersion = Deno.env.get("META_WHATSAPP_GRAPH_VERSION") ?? "v26.0";
    let selectedTemplate: ConversationTemplate | undefined;
    let templateComponents: Array<Record<string, unknown>> = [];
    if (listTemplates || sendTemplate) {
      const wabaId = templateWabaId;
      if (!wabaId)
        throw new Error(
          "A conta WhatsApp desta empresa não possui WABA configurada para consultar modelos",
        );
      const templates: ConversationTemplate[] = [];
      let after: string | undefined;
      do {
        const url = new URL(
          `https://graph.facebook.com/${graphVersion}/${wabaId}/message_templates`,
        );
        url.searchParams.set("fields", "name,status,language,category,components");
        url.searchParams.set("limit", "100");
        if (after) url.searchParams.set("after", after);
        const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const result = (await response.json()) as {
          data?: ConversationTemplate[];
          error?: { message?: string };
          paging?: { next?: string; cursors?: { after?: string } };
        };
        if (!response.ok || result.error)
          throw new Error(result.error?.message ?? "Falha ao consultar modelos na Meta");
        templates.push(...(result.data ?? []).filter(isAttendanceTemplate));
        after = result.paging?.next ? result.paging.cursors?.after : undefined;
      } while (after);
      templates.sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true }) ||
          a.language.localeCompare(b.language),
      );
      const { data: blockedUntil, error: cooldownError } = await admin.rpc("wa_marketing_cooldown_until", {
        p_id_empresa: lead.id_empresa, p_phone_number_id: phoneNumberId, p_recipient: recipient,
      });
      if (cooldownError) throw new Error("Não foi possível verificar a pausa de marketing. Tente novamente mais tarde.");
      if (listTemplates) return jsonResponse({ templates, marketingBlockedUntil: blockedUntil });
      selectedTemplate = templates.find(
        (t) => t.name === input.templateName && t.language === input.templateLanguage,
      );
      if (!selectedTemplate)
        throw new Error(
          "Selecione um modelo assumir_conversa aprovado pela Meta para esta empresa",
        );
      const values =
        input.templateValues &&
        typeof input.templateValues === "object" &&
        !Array.isArray(input.templateValues)
          ? (input.templateValues as Record<string, unknown>)
          : {};
      templateComponents = buildTemplateComponents(selectedTemplate, values);
      text =
        templatePreview(selectedTemplate, values as Record<string, string>) ||
        `[Modelo ${selectedTemplate.name}]`;
    }
    const requestPayload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      ...(selectedTemplate
        ? {
            type: "template",
            template: {
              name: selectedTemplate.name,
              language: { code: selectedTemplate.language },
              ...(templateComponents.length ? { components: templateComponents } : {}),
            },
          }
        : attachment
          ? {
              type: attachment.kind,
              [attachment.kind]: {
                link: attachment.url,
                ...(caption ? { caption } : {}),
                ...(attachment.kind === "document" ? { filename: attachment.filename } : {}),
              },
            }
          : { type: "text", text: { preview_url: false, body: text } }),
    };
    if (attachment) {
      const { data: freshLead } = await admin
        .from("lead")
        .select("atendimento_humano,wa_conversation_assigned_to")
        .eq("id", lead.id)
        .eq("id_empresa", lead.id_empresa)
        .maybeSingle();
      const { data: freshWindow, error: freshWindowError } = await admin.rpc(
        "crm_whatsapp_conversation_windows",
        { p_id_empresa: lead.id_empresa, p_lead_ids: [lead.id] },
      );
      if (
        !freshLead?.atendimento_humano ||
        freshLead.wa_conversation_assigned_to !== crmUser.id ||
        freshWindowError ||
        !freshWindow?.[0]?.window_open
      )
        throw new Error("O atendimento ou a janela de 24 horas mudou. O anexo não foi enviado.");
    }
    // Recheck immediately before provider I/O, including callers bypassing the UI.
    if (selectedTemplate) {
      if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(selectedTemplate.category ?? ""))
        throw new Error("Não foi possível confirmar a categoria deste template na Meta.");
      if (selectedTemplate.category === "MARKETING") {
        const { data: until, error } = await admin.rpc("wa_marketing_cooldown_until", {
          p_id_empresa: lead.id_empresa, p_phone_number_id: phoneNumberId, p_recipient: recipient,
        });
        if (error) throw new Error("Não foi possível verificar a pausa de marketing. Tente novamente mais tarde.");
        if (until) return jsonResponse({
          error: "A Meta restringiu temporariamente a entrega de marketing para este contato (131049). Novos templates de marketing estão pausados por 24 horas, até " + new Date(until).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) + " (Brasília). A entrega após esse prazo ainda depende da Meta.",
          code: "marketing_cooldown", marketingBlockedUntil: until,
        }, 429);
      }
    }
    const {data:delivery,error:reserveError}=await admin.rpc('hub_delivery_reserve',deliveryArgs);
    if(reserveError)throw new Error(reserveError.message);
    if(!delivery?.owned)return finishDelivery(delivery);
    deliveryStarted=true;
    // The committed reservation is never automatically expired/retried after provider I/O.
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
      if (graphResult.error?.code === 131049) {
        const eventAt = new Date().toISOString();
        const { error: cooldownError } = await admin.rpc("wa_record_marketing_cooldown", {
          p_phone_number_id: phoneNumberId, p_recipient: recipient, p_source_key: "hub:" + clientMessageId,
          p_event_at: eventAt, p_id_empresa: lead.id_empresa,
        });
        if (cooldownError) console.error("Unable to persist Meta marketing cooldown", cooldownError.code);
        return jsonResponse({ error: "A Meta restringiu temporariamente a entrega para este contato (131049). " + (cooldownError ? "Não repita o envio agora; não foi possível registrar a pausa automática." : "Novos templates de marketing estão pausados por 24 horas. A entrega após esse prazo ainda depende da Meta."), code: "131049" }, 429);
      }
      const code = graphResult.error?.code ? ` (código ${graphResult.error.code})` : "";
      throw new Error(`${graphResult.error?.message ?? "Falha ao enviar pela Meta"}${code}`);
    }

    const messageId = graphResult.messages?.[0]?.id;
    if (!messageId) throw new Error("A Meta não retornou o identificador da mensagem");
    const now = new Date().toISOString();
    const status = graphResult.messages?.[0]?.message_status ?? "accepted";
    const responseContact = graphResult.contacts?.[0];
    const resolvedWaId = normalizePhone(responseContact?.wa_id) ?? recipientPhone;
    const resolvedUserId =
      normalizeRecipient(responseContact?.user_id) ??
      normalizeRecipient(identity?.wa_user_id) ??
      normalizeRecipient(lead.wa_user_id);

    const transport={
          phone_number_id: phoneNumberId,
          message_id: messageId,
          client_message_id: clientMessageId,
          direction: "outbound",
          from_wa_id: fromWaId,
          to_wa_id: resolvedWaId,
          to_user_id: resolvedUserId,
          to_username: identity?.username ?? lead.wa_username,
          type: selectedTemplate ? "template" : attachment ? attachment.kind : "text",
          ...(selectedTemplate
            ? {
                template_name: selectedTemplate.name,
                template_language: selectedTemplate.language,
                template_variables: input.templateValues ?? {},
              }
            : {}),
          text_body: text,
          timestamp_meta: now,
          sent_at: now,
          status_current: status,
          status_last_at: now,
          tenant_id: lead.id_empresa,
          wa_identity_id: lead.wa_identity_id,
          conversation_key: lead.conversation_key ?? identity?.conversation_key,
          legacy_conversation_key:
            lead.legacy_conversation_key ?? identity?.legacy_conversation_key,
          raw: {
            source: "hub_human",
            ...(attachment
              ? {
                  attachment: {
                    storagePath: attachment.path,
                    filename: attachment.filename,
                    mimeType: attachment.mime,
                    fileSize: attachment.size,
                    kind: attachment.kind,
                  },
                }
              : {}),
            recipient_kind: recipientPhone ? "wa_id" : "bsuid",
            request: requestPayload,
            response: graphResult,
          },
          updated_at: now,
        };
    const phone = normalizePhone(identity?.telefone) ?? normalizePhone(lead.numero);
    const history={
      numero: phone ?? recipient,
      telefone: phone,
      type: "ai",
      message: attachment
        ? {
            content: text,
            attachment: {
              storagePath: attachment.path,
              filename: attachment.filename,
              mimeType: attachment.mime,
              fileSize: attachment.size,
              kind: attachment.kind,
              caption,
            },
          }
        : text,
      time: now,
      id_empresa: lead.id_empresa,
      wa_identity_id: lead.wa_identity_id,
      wa_user_id: identity?.wa_user_id ?? lead.wa_user_id,
      wa_username: identity?.username ?? lead.wa_username,
      conversation_key: lead.conversation_key ?? identity?.conversation_key,
      legacy_conversation_key: lead.legacy_conversation_key ?? identity?.legacy_conversation_key,
      wa_message_id: null,
    };
    const {error:receiptError}=await admin.rpc('hub_delivery_receipt',{
      p_id:delivery.id,p_token:delivery.claim_token,p_receipt:{transport,history},
    });
    if(receiptError)return jsonResponse({error:'Mensagem enviada; confirmação técnica pendente. Não reenviar.',deliveryUncertain:true},409);
    return finishDelivery({...delivery,state:'accepted'});

  } catch (error) {
    console.error(error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Falha ao enviar mensagem", deliveryUncertain:deliveryStarted },
      400,
    );
  }
});
