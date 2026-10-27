// Runtime configuration comes exclusively from the token-scoped database bridge.
type Config = {
  provider: "evolution" | "uazapi";
  instance: string;
  baseUrl: string;
  apiKey: string;
};
type Job = { id: string; lease: string; instance: string; phone: string; body: string };
type Dependencies = {
  load: (token: string) => Promise<Config | null>;
  call: (
    token: string,
    operation: "claim" | "finish",
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  fetcher?: typeof fetch;
};
const reply = (status: number, value: object) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
export function createSecretaryWorker({ load, call, fetcher = fetch }: Dependencies) {
  return async (req: Request) => {
    if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
    const token = req.headers.get("x-hub-secret");
    if (!token || token.length < 32 || token.length > 512)
      return reply(401, { error: "unauthorized" });
    try {
      const config = await load(token);
      if (!config) return reply(401, { error: "unauthorized" });
      // Same provider allowlist as private.hub_secretary_runtime.
      const allowed =
        (config.provider === "evolution" &&
          config.baseUrl === "https://evolution.henaweb.com.br") ||
        (config.provider === "uazapi" &&
          /^https:\/\/[a-z0-9-]+\.uazapi\.com$/.test(config.baseUrl));
      if (!allowed || !config.apiKey || !config.instance)
        return reply(503, { error: "integration_unavailable" });
      let processed = 0;
      for (let i = 0; i < 3; i++) {
        const job = (await call(token, "claim", {})) as Job | null;
        if (!job) break;
        let status = "failed";
        let providerId: string | null = null;
        if (
          job.instance === config.instance &&
          /^[1-9][0-9]{9,14}$/.test(job.phone) &&
          typeof job.body === "string" &&
          job.body.length <= 10000
        ) {
          try {
            const res = await fetcher(
              config.provider === "uazapi"
                ? `${config.baseUrl}/send/text`
                : `${config.baseUrl}/message/sendText/${encodeURIComponent(config.instance)}`,
              {
                method: "POST",
                redirect: "error",
                signal: AbortSignal.timeout(8000),
                headers: {
                  "Content-Type": "application/json",
                  [config.provider === "uazapi" ? "token" : "apikey"]: config.apiKey,
                },
                body: JSON.stringify({ number: job.phone, text: job.body, linkPreview: false }),
              },
            );
            if (res.status === 429) status = "rate_limited";
            else if (res.status >= 400 && res.status < 500 && res.status !== 408) status = "failed";
            else if (!res.ok) status = "uncertain";
            else {
              const data = await res.json();
              const id =
                config.provider === "uazapi" ? (data?.messageid ?? data?.messageId) : data?.key?.id;
              if (typeof id === "string" && id.length > 0 && id.length <= 200) {
                status = "sent";
                providerId = id;
              } else status = "uncertain";
            }
          } catch {
            status = "uncertain";
          }
        }
        await call(token, "finish", {
          p_id: job.id,
          p_lease: job.lease,
          p_status: status,
          p_provider_id: providerId,
        });
        processed++;
        if (status !== "sent") break;
      }
      return reply(200, { processed });
    } catch {
      return reply(503, { error: "worker_unavailable" });
    }
  };
}
