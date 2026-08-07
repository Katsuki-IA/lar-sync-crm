import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

export const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

export function createSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Configuração interna do Supabase ausente");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function constantTimeEquals(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export function authorizeN8n(req: Request, secretName: string) {
  const configuredSecret = Deno.env.get(secretName)?.trim() ?? "";
  if (!configuredSecret) {
    return jsonResponse({ error: "Integração n8n ainda não configurada" }, 503);
  }

  const suppliedSecret = req.headers.get("x-n8n-secret")?.trim() ?? "";
  if (!suppliedSecret || !constantTimeEquals(suppliedSecret, configuredSecret)) {
    return jsonResponse({ error: "Não autorizado" }, 401);
  }

  return null;
}

export async function readJsonObject(req: Request) {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 512_000) {
    throw new Error("Payload excede o limite permitido");
  }

  const raw = await req.text();
  if (raw.length > 512_000) throw new Error("Payload excede o limite permitido");
  if (!raw.trim()) return {} as Record<string, unknown>;

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Payload JSON inválido");
  }
  return parsed as Record<string, unknown>;
}

export function positiveInteger(value: unknown, fieldName: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} inválido`);
  }
  return parsed;
}

export function requiredString(value: unknown, fieldName: string, maxLength = 255) {
  const parsed = String(value ?? "").trim();
  if (!parsed || parsed.length > maxLength) throw new Error(`${fieldName} inválido`);
  return parsed;
}

export function optionalString(value: unknown, maxLength = 2_000) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = String(value).trim();
  if (!parsed) return null;
  if (parsed.length > maxLength) throw new Error("Campo de texto excede o limite permitido");
  return parsed;
}

export function methodNotAllowed() {
  return jsonResponse({ error: "Método não permitido" }, 405);
}

export function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Erro interno";
  const isInputError = /inválido|excede|JSON/i.test(message);
  console.error(message);
  return jsonResponse({ error: isInputError ? message : "Erro interno" }, isInputError ? 400 : 500);
}
