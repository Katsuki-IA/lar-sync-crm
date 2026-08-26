import { createSupabaseAdmin } from "./meta.ts";

const DEFAULT_GRAPH_VERSION = "v26.0";

type GraphError = {
  error?: {
    code?: number;
    error_subcode?: number;
    message?: string;
    type?: string;
  };
};

export type WhatsAppConfig = {
  appId: string;
  appSecret: string;
  configId: string;
  graphVersion: string;
  encryptionKey: string;
};

export function getWhatsAppConfig(requireSecrets = true): WhatsAppConfig {
  const config = {
    appId: Deno.env.get("META_WHATSAPP_APP_ID") ?? "",
    appSecret: Deno.env.get("META_WHATSAPP_APP_SECRET") ?? "",
    configId: Deno.env.get("META_WHATSAPP_CONFIG_ID") ?? "",
    graphVersion: Deno.env.get("META_WHATSAPP_GRAPH_VERSION") ?? DEFAULT_GRAPH_VERSION,
    encryptionKey: Deno.env.get("META_WHATSAPP_TOKEN_ENCRYPTION_KEY") ?? "",
  };

  if (!config.appId || !config.configId) {
    throw new Error("Embedded Signup ainda não foi configurado para este ambiente");
  }
  if (requireSecrets && (!config.appSecret || !config.encryptionKey)) {
    throw new Error("Segredos do Embedded Signup ainda não foram configurados no Supabase");
  }

  return config;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getEncryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await getEncryptionKey(secret),
    new TextEncoder().encode(value),
  );
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(value: string, secret: string): Promise<string> {
  const [version, encodedIv, encodedPayload] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedPayload) {
    throw new Error("Credencial do WhatsApp em formato inválido");
  }
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(encodedIv) },
    await getEncryptionKey(secret),
    base64ToBytes(encodedPayload),
  );
  return new TextDecoder().decode(decrypted);
}

export async function graphRequest<T>(
  config: Pick<WhatsAppConfig, "graphVersion">,
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${path}`);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(url, { ...init, headers });
  const payload = (await response.json()) as T & GraphError;
  if (!response.ok || payload.error) {
    const details = payload.error?.code ? ` (código ${payload.error.code})` : "";
    throw new Error(`${payload.error?.message ?? "Falha na Graph API"}${details}`);
  }
  return payload;
}

export async function createOnboardingSession(args: {
  idEmpresa: number;
  userId: string;
}): Promise<string> {
  const supabaseAdmin = createSupabaseAdmin();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await supabaseAdmin
    .from("crm_whatsapp_onboarding_sessions")
    .delete()
    .eq("id_empresa", args.idEmpresa)
    .eq("auth_user_id", args.userId)
    .is("consumed_at", null);

  const { data, error } = await supabaseAdmin
    .from("crm_whatsapp_onboarding_sessions")
    .insert({
      id_empresa: args.idEmpresa,
      auth_user_id: args.userId,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function consumeOnboardingSession(args: {
  sessionId: string;
  idEmpresa: number;
  userId: string;
}): Promise<void> {
  const supabaseAdmin = createSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("crm_whatsapp_onboarding_sessions")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", args.sessionId)
    .eq("id_empresa", args.idEmpresa)
    .eq("auth_user_id", args.userId)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sessão de conexão expirada. Inicie a conexão novamente.");
}

export function randomRegistrationPin(): string {
  const values = crypto.getRandomValues(new Uint32Array(1));
  return String(values[0] % 1_000_000).padStart(6, "0");
}
