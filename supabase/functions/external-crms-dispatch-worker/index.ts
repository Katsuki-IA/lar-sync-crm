import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type QueueJob = {
  id: string;
  id_empresa: number;
  crm_lead_id: number;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown> | null;
};

class WorkerDispatchError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "WorkerDispatchError";
    this.retryable = retryable;
  }
}

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

async function parseResponse(response: Response) {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function responseError(payload: any, status: number) {
  return String(payload?.error ?? payload?.message ?? `Envio retornou HTTP ${status}`).slice(0, 2000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido" }, 405);

  const workerSecret = Deno.env.get("EXTERNAL_CRMS_WORKER_SECRET")?.trim() ?? "";
  if (!workerSecret || req.headers.get("x-worker-secret")?.trim() !== workerSecret) {
    return jsonResponse({ error: "Acesso do worker inválido" }, 401);
  }

  try {
    const admin = createSupabaseAdmin();
    const supabaseUrl = String(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
    const internalSecret = Deno.env.get("EXTERNAL_CRMS_INTERNAL_SECRET")?.trim() ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit ?? 20), 1), 50);

    const { data, error } = await admin.rpc("crm_claim_external_dispatch_jobs", {
      p_limit: limit,
    });
    if (error) throw new Error(error.message);

    const jobs = (Array.isArray(data) ? data : []) as QueueJob[];
    const results: Array<{ id: string; status: string; error?: string }> = [];

    for (const job of jobs) {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (internalSecret) {
          headers["x-internal-secret"] = internalSecret;
        } else {
          headers.apikey = serviceRoleKey;
          headers.Authorization = `Bearer ${serviceRoleKey}`;
        }

        const response = await fetch(`${supabaseUrl}/functions/v1/external-crms-dispatch`, {
          method: "POST",
          headers,
          body: JSON.stringify(job.payload ?? {
            leadId: job.crm_lead_id,
            idEmpresa: job.id_empresa,
          }),
        });
        const responsePayload = await parseResponse(response);
        if (!response.ok) {
          throw new WorkerDispatchError(
            responseError(responsePayload, response.status),
            responsePayload?.retryable !== false,
          );
        }

        const { error: updateError } = await admin
          .from("crm_external_dispatch_queue")
          .update({
            status: "sent",
            processed_at: new Date().toISOString(),
            locked_at: null,
            last_error: null,
          })
          .eq("id", job.id);
        if (updateError) throw new Error(updateError.message);
        results.push({ id: job.id, status: "sent" });
      } catch (jobError) {
        const message = jobError instanceof Error ? jobError.message : "Erro inesperado";
        const retryAllowed = !(jobError instanceof WorkerDispatchError) || jobError.retryable;
        const retry = retryAllowed && job.attempts < job.max_attempts;
        const retryMinutes = Math.min(5 * 2 ** Math.max(job.attempts - 1, 0), 60);
        const values = retry
          ? {
              status: "pending",
              scheduled_at: new Date(Date.now() + retryMinutes * 60 * 1000).toISOString(),
              locked_at: null,
              last_error: message.slice(0, 2000),
            }
          : {
              status: "failed",
              processed_at: new Date().toISOString(),
              locked_at: null,
              last_error: message.slice(0, 2000),
            };

        const { error: updateError } = await admin
          .from("crm_external_dispatch_queue")
          .update(values)
          .eq("id", job.id);
        if (updateError) console.error("Falha ao atualizar job", job.id, updateError);
        results.push({ id: job.id, status: retry ? "pending" : "failed", error: message });
      }
    }

    return jsonResponse({
      ok: true,
      claimed: jobs.length,
      sent: results.filter((item) => item.status === "sent").length,
      pending: results.filter((item) => item.status === "pending").length,
      failed: results.filter((item) => item.status === "failed").length,
      results,
    });
  } catch (error) {
    console.error("Falha no worker de envio para CRM", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "Erro inesperado",
    }, 500);
  }
});
