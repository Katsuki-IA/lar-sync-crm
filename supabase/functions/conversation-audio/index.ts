import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const bucket = "conversation-audio";
const maxBytes = 16 * 1024 * 1024;
const extensions: Record<string, string> = {
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a",
  "audio/aac": "aac", "audio/amr": "amr", "audio/wav": "wav",
};
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return response({ error: "Método inválido" }, 405);
  try {
    const authorization = req.headers.get("authorization") || "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await admin.auth.getUser(authorization.replace(/^Bearer /, ""));
    if (authError || !auth.user) return response({ error: "Sessão inválida" }, 401);
    const input = await req.json();
    const leadId = Number(input.leadId);
    // The Hub prefixes history IDs for React keys; accept only this known prefix.
    const chatValue = String(input.chatId ?? "");
    const chatId = /^(?:chat-)?[1-9][0-9]*$/.test(chatValue)
      ? Number(chatValue.replace(/^chat-/, "")) : NaN;
    if (![leadId, chatId].every(n => Number.isSafeInteger(n) && n > 0 && n < Number.MAX_SAFE_INTEGER)) {
      return response({ error: "Conversa inválida" }, 400);
    }
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Reuse the exact conversation visibility rules, including assigned agents.
    const { data: visible, error: denied } = await user.rpc("crm_whatsapp_conversation_messages_v2", {
      p_lead_id: leadId, p_before_id: chatId + 1, p_limit: 1,
    });
    if (denied || !visible?.some((row: { id: number }) => Number(row.id) === chatId)) {
      return response({ error: "Sem acesso a este áudio" }, 403);
    }
    const { data: chat } = await admin.from("n8n_chat_conversas")
      .select("wa_message_id,id_empresa").eq("id", chatId).single();
    const { data: lead } = await admin.from("lead").select("id_empresa").eq("id", leadId).single();
    if (!chat?.wa_message_id || !lead || (chat.id_empresa != null && chat.id_empresa !== lead.id_empresa)) {
      return response({ error: "Arquivo de áudio não vinculado à conversa" }, 404);
    }
    const { data: message } = await admin.from("wa_messages")
      .select("id,phone_number_id,tenant_id,direction,raw").eq("id", chat.wa_message_id).single();
    if (!message || message.direction !== "inbound" ||
        (message.tenant_id != null && message.tenant_id !== lead.id_empresa)) {
      return response({ error: "Áudio não encontrado" }, 404);
    }
    const audio = message.raw?.message?.audio;
    if (!audio?.id || !/^[0-9]+$/.test(String(audio.id))) {
      return response({ error: "Identificador do áudio indisponível" }, 404);
    }
    const mime = String(audio.mime_type || "").split(";")[0].trim().toLowerCase();
    const extension = extensions[mime];
    if (!extension) return response({ error: "Formato de áudio não suportado" }, 415);
    const path = lead.id_empresa + "/" + message.id + "." + extension;
    const storage = admin.storage.from(bucket);
    const { data: cached } = await storage.info(path);
    if (!cached) {
      const { data: credential } = await admin.from("credentials")
        .select("whatsapp_access_token").eq("id_empresa", lead.id_empresa)
        .eq("whatsapp_business_id", message.phone_number_id).single();
      if (!credential?.whatsapp_access_token) throw new Error("credential");
      const headers = { Authorization: "Bearer " + credential.whatsapp_access_token };
      const metadataResponse = await fetch("https://graph.facebook.com/v24.0/" + audio.id, {
        headers, signal: AbortSignal.timeout(15000),
      });
      if (!metadataResponse.ok) return response({ error: "A Meta não disponibilizou o áudio. Tente novamente." }, 502);
      const metadata = await metadataResponse.json();
      const mediaUrl = new URL(metadata.url);
      if (mediaUrl.protocol !== "https:" || mediaUrl.hostname !== "lookaside.fbsbx.com" ||
          Number(metadata.file_size) > maxBytes) throw new Error("media");
      const download = await fetch(mediaUrl, {
        headers, redirect: "error", signal: AbortSignal.timeout(20000),
      });
      if (!download.ok || !download.body) throw new Error("download");
      const reader = download.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new Error("size"); }
        chunks.push(value);
      }
      if (!size) throw new Error("empty");
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (mime === "audio/ogg" && new TextDecoder().decode(bytes.slice(0, 4)) !== "OggS") throw new Error("format");
      const { error: uploadError } = await storage.upload(path, bytes, { contentType: mime, upsert: true });
      if (uploadError) throw new Error("storage");
    }
    const { data: signed, error: signError } = await storage.createSignedUrl(path, 900);
    if (signError || !signed) throw new Error("signed_url");
    return response({ url: signed.signedUrl, mime, filename: "audio." + extension });
  } catch {
    return response({ error: "Não foi possível carregar o áudio. Tente novamente." }, 502);
  }
});
