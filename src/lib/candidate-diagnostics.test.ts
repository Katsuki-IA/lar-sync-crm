import { describe, expect, it } from "vitest";
import { candidateRuntimeReady } from "./candidate-runtime";
import { diagnoseCandidate, formatDiagnostic, resolveRuntimeEnv } from "./candidate-diagnostics";

const URL = "https://tswdxgefmhjvjwafaxjl.supabase.co";
const PUB = "public-key-fixture";
const SRV = "server-key-fixture";
const good = { SUPABASE_URL: URL, SUPABASE_PUBLISHABLE_KEY: PUB, SUPABASE_SERVICE_ROLE_KEY: SRV };

describe("candidate diagnostics", () => {
  it("reads Cloudflare bindings from the request when process.env is empty", () => {
    const r = resolveRuntimeEnv({ request: good, process: {} });
    expect(candidateRuntimeReady(r.env, URL, PUB)).toBe(true);
    expect(diagnoseCandidate(r, URL, PUB).publicKeySource).toBe("request");
  });

  it("prefers argument over request, global and process", () => {
    const r = resolveRuntimeEnv({ argument: good, request: { SUPABASE_URL: "x" }, global: {}, process: {} });
    expect(r.origin.SUPABASE_URL).toBe("argument");
  });

  it("falls back to global then process", () => {
    expect(resolveRuntimeEnv({ global: good }).origin.SUPABASE_URL).toBe("global");
    expect(resolveRuntimeEnv({ process: good }).origin.SUPABASE_URL).toBe("process");
    expect(resolveRuntimeEnv({}).origin.SUPABASE_URL).toBe("none");
  });

  it("flags a different public key without exposing values", () => {
    const r = resolveRuntimeEnv({ request: { ...good, SUPABASE_PUBLISHABLE_KEY: "other" } });
    const d = diagnoseCandidate(r, URL, PUB);
    expect(d.publicKeyPresent).toBe(true);
    expect(d.publicKeyMatches).toBe(false);
    const text = formatDiagnostic(d);
    for (const secret of [PUB, SRV, "other", URL]) expect(text).not.toContain(secret);
  });

  it("flags another project URL and a missing server key", () => {
    const r = resolveRuntimeEnv({ request: { SUPABASE_URL: "https://outro.supabase.co", SUPABASE_PUBLISHABLE_KEY: PUB } });
    const d = diagnoseCandidate(r, URL, PUB);
    expect(d.urlMatches).toBe(false);
    expect(d.serverKeyPresent).toBe(false);
    expect(d.serverKeySource).toBe("none");
  });
});
