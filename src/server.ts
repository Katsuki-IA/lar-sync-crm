import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { candidateRuntimeReady } from "./lib/candidate-runtime";
import { resolveRuntimeEnv } from "./lib/candidate-diagnostics";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

// Cloudflare bindings take precedence; process.env is the Node/dev fallback.
// Nitro's Cloudflare handler calls this entry as fetch(request) and attaches the
// bindings to request.runtime.cloudflare.env (also globalThis.__env__).
function runtimeEnv(request: Request, env: unknown) {
  return resolveRuntimeEnv({
    argument: env,
    request: (request as Request & { runtime?: { cloudflare?: { env?: unknown } } }).runtime?.cloudflare?.env,
    global: (globalThis as { __env__?: unknown }).__env__,
    process: process.env as Record<string, unknown>,
  });
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
    const resolved = runtimeEnv(request, env);
    if (import.meta.env.HUB_PRODUCTION_CANDIDATE && !candidateRuntimeReady(resolved.env,
      import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
      // TEMPORARY diagnostic: booleans and source labels only, no values.
      const diag = formatDiagnostic(diagnoseCandidate(resolved,
        import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY));
      return new Response(`Candidato indisponível: configuração do servidor pendente.\n\nDiagnóstico: ${diag}\n`, {
        status:503,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store',
          'x-candidate-diag':diag},
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

