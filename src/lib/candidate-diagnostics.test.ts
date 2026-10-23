import { describe, expect, it } from "vitest";
import { candidateRuntimeReady } from "./candidate-runtime";
import { resolveRuntimeEnv } from "./candidate-diagnostics";

const URL = "https://tswdxgefmhjvjwafaxjl.supabase.co";
const PUB = "public-key-fixture";
const SRV = "server-key-fixture";
const good = { SUPABASE_URL: URL, SUPABASE_PUBLISHABLE_KEY: PUB, SUPABASE_SERVICE_ROLE_KEY: SRV };

describe("candidate runtime env resolution", () => {
  it("reads Cloudflare bindings from the request when process.env is empty", () => {
    const r = resolveRuntimeEnv({ request: good, process: {} });
    expect(candidateRuntimeReady(r.env, URL, PUB)).toBe(true);
    expect(r.origin.SUPABASE_URL).toBe("request");
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
});
