import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { candidateRuntimeReady } from "./lib/candidate-runtime";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

// Cloudflare bindings take precedence; process.env is the Node/dev fallback.
// Nitro's Cloudflare handler calls this entry as fetch(request) and attaches the
// bindings to request.runtime.cloudflare.env (also globalThis.__env__).
const RUNTIME_KEYS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "APP_SUPABASE_SERVICE_ROLE_KEY"] as const;
function cloudflareBindings(request: Request, env: unknown): Record<string, unknown> {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
  const fromReq = (request as Request & { runtime?: { cloudflare?: { env?: unknown } } }).runtime?.cloudflare?.env;
  const fromGlobal = (globalThis as { __env__?: unknown }).__env__;
  return { ...(isObj(fromGlobal) ? fromGlobal : {}), ...(isObj(fromReq) ? fromReq : {}), ...(isObj(env) ? env : {}) };
}
function runtimeEnv(request: Request, env: unknown): Record<string, string | undefined> {
  const b = cloudflareBindings(request, env);
  const out: Record<string, string | undefined> = {};
  for (const k of RUNTIME_KEYS) {
    const v = b[k];
    out[k] = typeof v === "string" && v.trim() ? v : process.env[k];
  }
  return out;
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    if (import.meta.env.HUB_PRODUCTION_CANDIDATE && !candidateRuntimeReady(runtimeEnv(request, env),
      import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
      return new Response('Candidato indisponível: configuração do servidor pendente.', {
        status:503,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'},
      });
    }
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

