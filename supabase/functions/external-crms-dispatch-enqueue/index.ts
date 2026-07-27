import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret, x-crm-dispatch-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type EnqueuePayload = {
  leadId: number;
  idEmpresa: number;
  idEmpreendimento?: number;
  additionalTags?: string[];
  triggerReference?: string;
  externalStageKind?: string;
  conversationSummary?: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function createSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authenticate(
  admin: ReturnType<typeof createSupabaseAdmin>,
  req: Request,
  idEmpresa: number,
) {
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const apiKey = req.headers.get("apikey")?.trim() ?? "";
  const internalHeader = req.headers.get("x-internal-secret")?.trim() ?? "";
  const crmToken = req.headers.get("x-crm-dispatch-token")?.trim() ?? "";
  const internalSecret = Deno.env.get("EXTERNAL_CRMS_INTERNAL_SECRET")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";

  if (
    (internalSecret && (internalHeader === internalSecret || bearerToken === internalSecret)) ||
    (serviceRoleKey && (apiKey === serviceRoleKey || bearerToken === serviceRoleKey))
  ) {
    return;
  }

  if (crmToken) {
    const { data, error } = await admin
      .from("credentials")
      .select("cv_crm_token,rd_crm_access_token")
      .eq("id_empresa", idEmpresa)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const validTokens = [data?.cv_crm_token, data?.rd_crm_access_token]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    if (validTokens.includes(crmToken)) return;
  }

  throw new Error("Acesso interno inválido");
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((tag) => String(tag ?? "").trim()).filter(Boolean)),
  ).slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido" }, 405);

  try {
    const payload = (await req.json()) as EnqueuePayload;
    const leadId = Number(payload?.leadId);
    const idEmpresa = Number(payload?.idEmpresa);
    const idEmpreendimento = Number(payload?.idEmpreendimento);
    if (!Number.isSafeInteger(leadId) || leadId <= 0) {
      return jsonResponse({ error: "leadId inválido" }, 400);
    }
    if (!Number.isSafeInteger(idEmpresa) || idEmpresa <= 0) {
      return jsonResponse({ error: "idEmpresa inválido" }, 400);
    }

    const admin = createSupabaseAdmin();
    await authenticate(admin, req, idEmpresa);

    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const additionalTags = normalizeTags(payload.additionalTags);
    const triggerReference = String(payload.triggerReference ?? "").trim() || null;
    const externalStageKind = String(payload.externalStageKind ?? "").trim() || null;
    const conversationSummary = String(payload.conversationSummary ?? "").trim() || null;

    const { data: job, error } = await admin.rpc("crm_enqueue_external_dispatch", {
      p_id_empresa: idEmpresa,
      p_crm_lead_id: leadId,
      p_scheduled_at: scheduledAt,
      p_trigger_type: "followup",
      p_trigger_reference: triggerReference,
      p_payload: {
        leadId,
        idEmpresa,
        ...(Number.isSafeInteger(idEmpreendimento) && idEmpreendimento > 0 ? { idEmpreendimento } : {}),
        additionalTags,
        ...(externalStageKind ? { externalStageKind } : {}),
        ...(conversationSummary ? { conversationSummary } : {}),
      },
      p_max_attempts: 3,
    });
    if (error) throw new Error(error.message);
    const queueJob = Array.isArray(job) ? job[0] : job;

    return jsonResponse({
      ok: true,
      queued: true,
      scheduledAt: queueJob?.scheduled_at ?? scheduledAt,
      jobId: queueJob?.id ?? null,
      status: queueJob?.status ?? "pending",
    });
  } catch (error) {
    console.error("Falha ao agendar envio para CRM externo", error);
    const message = error instanceof Error ? error.message : "Erro inesperado";
    const status = message.includes("Acesso interno") ? 401 : 500;
    return jsonResponse({ error: message }, status);
  }
});
