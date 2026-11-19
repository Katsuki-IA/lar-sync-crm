// Chat web público da Clara. Sessão por cookie httpOnly (banco guarda só hash),
// idempotência por requestId, lease com token por tentativa e limites no banco.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CLARA_EMPRESA_ID, isAllowedOrigin, MAX_BODY_BYTES, statusToHttp, type BeginStatus } from "@/lib/clara-chat";

const COOKIE = "clara_sid";
const postSchema = z.object({
  requestId: z.string().uuid(),
  kind: z.enum(["greeting", "message"]),
  text: z.string().trim().min(1).max(2000).optional(),
}).strict();

async function sha256(v: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function readToken(req: Request) {
  const m = (req.headers.get("cookie") ?? "").match(/(?:^|;\s*)clara_sid=([A-Za-z0-9_-]{43})/);
  return m?.[1] ?? null;
}
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const ipHash = (req: Request) =>
  sha256(`clara-ip:${req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0"}`);
function json(body: unknown, status = 200, cookie?: string) {
  const h = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (cookie) h.append("Set-Cookie", `${COOKIE}=${cookie}; Path=/api/public/clara-chat; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
  return new Response(JSON.stringify(body), { status, headers: h });
}
/** Lê o corpo com limite real de bytes antes de interpretar o JSON. */
async function readLimited(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size); let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(all);
}

export const Route = createFileRoute("/api/public/clara-chat")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let token = readToken(request);
        const isNew = !token;
        token ??= newToken();
        const { data, error } = await (supabaseAdmin as any).rpc("web_chat_open", {
          p_empresa: CLARA_EMPRESA_ID, p_token_hash: await sha256(token), p_ip_hash: await ipHash(request),
        });
        if (error) return json({ status: "unavailable" }, 503);
        if (data?.status !== "ok") return json({ status: data?.status ?? "invalid" }, statusToHttp(data?.status ?? "invalid"));
        return json(data, 200, isNew ? token : undefined);
      },
      POST: async ({ request }) => {
        if (!isAllowedOrigin(request.headers.get("origin"), request.url)) return json({ status: "forbidden" }, 403);
        if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json({ status: "invalid" }, 415);
        const raw = await readLimited(request);
        if (raw === null) return json({ status: "invalid" }, 413);
        const token = readToken(request);
        if (!token) return json({ status: "no_session" }, 401);
        let body: z.infer<typeof postSchema>;
        try { body = postSchema.parse(JSON.parse(raw)); } catch { return json({ status: "invalid" }, 400); }
        if ((body.kind === "message") !== !!body.text) return json({ status: "invalid" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const srv = await import("@/lib/clara-chat.server");
        const admin = supabaseAdmin as any;
        const tokenHash = await sha256(token);
        const transport = srv.resolveCompletionTransport(admin);
        if (!transport) return json({ status: "ai_not_configured" }, 503);

        const { data: begin, error } = await admin.rpc("web_chat_begin", {
          p_empresa: CLARA_EMPRESA_ID, p_token_hash: tokenHash, p_ip_hash: await ipHash(request),
          p_request: body.requestId, p_kind: body.kind, p_text: body.text ?? null,
        });
        if (error) return json({ status: "unavailable" }, 503);
        const status = begin?.status as BeginStatus;
        if (status !== "proceed") return json({ status, reply: begin?.reply ?? null }, statusToHttp(status));

        const leaseArgs = { p_empresa: CLARA_EMPRESA_ID, p_token_hash: tokenHash, p_request: begin.request_id, p_lease: begin.lease_token };
        const finish = (reply: string) => admin.rpc("web_chat_finish", { ...leaseArgs, p_reply: reply });
        try {
          const history = (begin.history as { role: "user" | "assistant"; content: string; created_at?: string }[])
            .map(({ role, content, created_at }) => ({ role, content, created_at }));
          const system = body.kind === "greeting" ? "" : await srv.loadSystemPrompt(admin, (begin.prompt_ids as number[]).map(Number));
          const out = await srv.generateClaraReply({
            system, history, greeting: body.kind === "greeting",
            model: String(begin.model), temperature: Number(begin.temperature), transport,
            runTool: srv.createToolRunner({
              admin, tokenHash, requestId: begin.request_id, leaseToken: begin.lease_token,
              userTexts: history.filter((m) => m.role === "user").map((m) => m.content),
              history, leadId: begin.lead_id == null ? null : Number(begin.lead_id),
            }),
          });
          const { data: done, error: fe } = await finish(out.text);
          if (fe) return json({ status: "unavailable" }, 503);
          return json(done, statusToHttp(done?.status ?? "failed"));
        } catch (e) {
          await finish("");
          if (e instanceof srv.ClaraNotConfiguredError) return json({ status: "ai_not_configured" }, 503);
          console.error("[clara-chat] geração falhou", e instanceof Error ? e.name : "erro");
          return json({ status: "failed" }, 502);
        }
      },
    },
  },
});
