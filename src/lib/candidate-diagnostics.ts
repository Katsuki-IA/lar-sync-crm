// TEMPORARY diagnostic for the candidate 503 guard. Emits only booleans and
// source labels — never values, hashes, lengths or prefixes of any key.
export const CANDIDATE_DIAG_REVISION = "diag-2026-10-23-a";

export const RUNTIME_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_SUPABASE_SERVICE_ROLE_KEY",
] as const;
type Key = (typeof RUNTIME_KEYS)[number];
export type EnvSource = "argument" | "request" | "global" | "process" | "none";

type Bag = Record<string, unknown> | undefined;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

/** Precedence: fetch argument > request.runtime.cloudflare.env > globalThis.__env__ > process.env */
export function resolveRuntimeEnv(sources: { argument?: unknown; request?: unknown; global?: unknown; process?: Bag }) {
  const order: [EnvSource, Bag][] = [
    ["argument", isObj(sources.argument) ? sources.argument : undefined],
    ["request", isObj(sources.request) ? sources.request : undefined],
    ["global", isObj(sources.global) ? sources.global : undefined],
    ["process", sources.process],
  ];
  const env: Record<string, string | undefined> = {};
  const origin = {} as Record<Key, EnvSource>;
  for (const k of RUNTIME_KEYS) {
    origin[k] = "none";
    for (const [name, bag] of order) {
      const v = bag ? str(bag[k]) : undefined;
      if (v) { env[k] = v; origin[k] = name; break; }
    }
  }
  return { env, origin };
}

export function diagnoseCandidate(
  resolved: ReturnType<typeof resolveRuntimeEnv>,
  expectedUrl: string,
  expectedPublicKey: string,
) {
  const { env, origin } = resolved;
  const serverKey = env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : "APP_SUPABASE_SERVICE_ROLE_KEY";
  return {
    revision: CANDIDATE_DIAG_REVISION,
    urlPresent: !!env.SUPABASE_URL,
    urlMatches: env.SUPABASE_URL?.trim().replace(/\/+$/, "") === expectedUrl,
    publicKeyPresent: !!env.SUPABASE_PUBLISHABLE_KEY,
    publicKeyMatches: env.SUPABASE_PUBLISHABLE_KEY?.trim() === expectedPublicKey,
    expectedPublicKeyCompiled: !!expectedPublicKey,
    serverKeyPresent: !!(env.SUPABASE_SERVICE_ROLE_KEY || env.APP_SUPABASE_SERVICE_ROLE_KEY),
    urlSource: origin.SUPABASE_URL,
    publicKeySource: origin.SUPABASE_PUBLISHABLE_KEY,
    serverKeySource: origin[serverKey],
  };
}

export function formatDiagnostic(d: ReturnType<typeof diagnoseCandidate>) {
  return Object.entries(d).map(([k, v]) => `${k}=${v}`).join("; ");
}
