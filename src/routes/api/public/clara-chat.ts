// Chat web público da Clara. Sessão por cookie httpOnly (banco guarda só hash),
// idempotência por requestId, lease por sessão e limites no banco (web_chat_*).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CLARA_EMPRESA_ID, statusToHttp, type BeginStatus } from "@/lib/clara-chat";

const COOKIE = "clara_sid";
const postSchema = z.object({
  requestId: z.string().uuid(),
  kind: z.enum(["greeting", "message"]),
  text: z.string().trim().max(2000).optional(),
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
        const status = (data?.status ?? "invalid") as BeginStatus;
        if (status !== "ok" as any) return json({ status }, statusToHttp(status));
        return json(data, 200, isNew ? token : undefined);
      },
      POST: async ({ request }) => {
        const token = readToken(request);
        if (!token) return json({ status: "no_session" }, 401);
        let body: z.infer<typeof postSchema>;
        try { body = postSchema.parse(await request.json()); } catch { return json({ status: "invalid" }, 400); }
        if (body.kind === "message" && !body.text) return json({ status: "invalid" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { ClaraNotConfiguredError, generateClaraReply, loadSystemPrompt } = await import("@/lib/clara-chat.server");
        const admin = supabaseAdmin as any;
        const tokenHash = await sha256(token);

        if (!String(process.env["OPENAI_API_KEY"] ?? "").trim()) return json({ status: "ai_not_configured" }, 503);

        const { data: begin, error } = await admin.rpc("web_chat_begin", {
          p_empresa: CLARA_EMPRESA_ID, p_token_hash: tokenHash, p_ip_hash: await ipHash(request),
          p_request: body.requestId, p_kind: body.kind, p_text: body.text ?? null,
        });
        if (error) return json({ status: "unavailable" }, 503);
        const status = begin?.status as BeginStatus;
        if (status !== "proceed") return json(begin, statusToHttp(status));

        const finish = (reply: string, contact: unknown) => admin.rpc("web_chat_finish", {
          p_empresa: CLARA_EMPRESA_ID, p_token_hash: tokenHash, p_request: begin.request_id,
          p_reply: reply, p_contact: contact ?? null,
        });
        try {
          const system = await loadSystemPrompt(admin, (begin.prompt_ids as number[]).map(Number));
          const history = (begin.history as { role: "user" | "assistant"; content: string }[])
            .map(({ role, content }) => ({ role, content }));
          const out = await generateClaraReply({
            system, history, greeting: body.kind === "greeting",
            model: String(begin.model), temperature: Number(begin.temperature),
          });
          const { data: done, error: fe } = await finish(out.text, out.contact ? { ...out.contact, informado_em: new Date().toISOString() } : null);
          if (fe) return json({ status: "unavailable" }, 503);
          return json(done, statusToHttp(done?.status ?? "failed"));
        } catch (e) {
          await finish("", null);
          if (e instanceof ClaraNotConfiguredError) return json({ status: "ai_not_configured" }, 503);
          console.error("[clara-chat] geração falhou", e instanceof Error ? e.message : "erro");
          return json({ status: "failed" }, 502);
        }
      },
    },
  },
});
