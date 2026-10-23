// Runtime env resolution for the candidate guard. Reads only which keys are
// present — never exposes values.
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
