import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import webpush from "npm:web-push@3.6.7";
import { ORIGINS, validEndpoint, validKeys } from "./validation.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
async function rpc(action: string, data: Record<string, unknown> = {}) {
 const r = await db.rpc("hub_push_service", { p_action: action, p_data: data });
 if (r.error) throw new Error(r.error.message);
 return r.data;
}
Deno.serve(async (req) => {
 const origin = req.headers.get("origin") ?? "";
 const cors = ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS" } : {};
 const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
 if (req.method === "OPTIONS") return new Response(null, { status: ORIGINS.has(origin) ? 204 : 403, headers: cors });
 if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
 try {
  const workerKey = req.headers.get("x-hub-push-key");
  if (workerKey) {
   if (workerKey.length > 100 || !(await rpc("worker_auth", { key: workerKey }))) return reply({ error: "Unauthorized" }, 401);
   const batch = await rpc("claim");
   if (!batch.jobs.length) return reply({ processed: 0 });
   if (!batch.publicKey || !batch.privateKey) throw new Error("Push keys not initialized");
   await Promise.all(batch.jobs.map(async (job: any) => {
    let status = 400;
    try {
     if (!validEndpoint(job.subscription.endpoint)) throw new Error("Invalid endpoint");
     const r = webpush.generateRequestDetails(job.subscription, JSON.stringify(job.payload), {
      TTL: job.ttl, urgency: "high",
      vapidDetails: { subject: "https://hub.katsuki.com.br", publicKey: batch.publicKey, privateKey: batch.privateKey }
     });
     const sent = await fetch(r.endpoint, { method: "POST", headers: r.headers, body: r.body,
      redirect: "error", signal: AbortSignal.timeout(12000) });
     status = sent.status;
     await sent.body?.cancel();
    } catch { status = validEndpoint(job.subscription.endpoint) ? 0 : 400; }
    await rpc("finish", { id: job.id, token: job.token, status });
   }));
   return reply({ processed: batch.jobs.length });
  }
  if (!ORIGINS.has(origin)) return reply({ error: "Origin not allowed" }, 403);
  const jwt = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!jwt) return reply({ error: "Unauthorized" }, 401);
  const { data: auth, error } = await db.auth.getUser(jwt);
  if (error || !auth.user) return reply({ error: "Unauthorized" }, 401);
  const { data: member } = await db.from("crm_users").select("id").eq("auth_user_id", auth.user.id).eq("active", true).maybeSingle();
  if (!member) return reply({ error: "Active account required" }, 403);
  const raw = await req.text();
  if (raw.length > 6000) return reply({ error: "Payload too large" }, 413);
  const input = JSON.parse(raw);
  if (input.action === "config") return reply(await rpc("config", webpush.generateVAPIDKeys()));
  if (!["register", "unregister", "status", "test"].includes(input.action) || !validEndpoint(input.endpoint))
   return reply({ error: "Invalid subscription" }, 400);
  if (input.action === "register" && !validKeys(input.p256dh, input.auth)) return reply({ error: "Invalid subscription keys" }, 400);
  return reply(await rpc(input.action, { authUser: auth.user.id, endpoint: input.endpoint,
   p256dh: input.p256dh, auth: input.auth, origin }));
 } catch {
  // Never log bearer tokens, subscription endpoints, private keys or provider response bodies.
  return reply({ error: "Não foi possível concluir. Tente novamente em instantes." }, 400);
 }
});
