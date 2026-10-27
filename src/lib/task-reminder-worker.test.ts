import { describe, it, expect, vi } from "vitest";
import { createSecretaryWorker } from "../../supabase/functions/_shared/secretary-worker";
const token = "test-only-token-".repeat(3);
const config = {
  provider: "evolution" as const,
  baseUrl: "https://evolution.henaweb.com.br",
  instance: "test",
  apiKey: "fake-only",
};
const job = {
  id: "job",
  lease: "lease",
  phone: "5511999999999",
  instance: "test",
  body: "Lembrete: tarefa de teste",
};
const request = () =>
  new Request("https://example.invalid/worker", {
    method: "POST",
    headers: { "x-hub-secret": token },
  });
function setup(response: () => Promise<Response>) {
  let claimed = false;
  const call = vi.fn(async (_token: string, operation: string) =>
    operation === "claim" ? (claimed ? null : ((claimed = true), job)) : {},
  );
  const fetcher = vi.fn(response);
  return {
    call,
    fetcher,
    handler: createSecretaryWorker({
      load: async () => config,
      call,
      fetcher: fetcher as typeof fetch,
    }),
  };
}
describe("Secretary task delivery contract", () => {
  it("sends to server-selected recipient and confirms the lease", async () => {
    const { handler, call, fetcher } = setup(
      async () => new Response(JSON.stringify({ key: { id: "provider-1" } })),
    );
    const res = await handler(request());
    expect(res.status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith(
      "https://evolution.henaweb.com.br/message/sendText/test",
      expect.objectContaining({
        redirect: "error",
        body: JSON.stringify({ number: job.phone, text: job.body, linkPreview: false }),
      }),
    );
    expect(call).toHaveBeenCalledWith(token, "finish", {
      p_id: "job",
      p_lease: "lease",
      p_status: "sent",
      p_provider_id: "provider-1",
    });
  });
  it.each([
    [429, "rate_limited"],
    [500, "uncertain"],
    [408, "uncertain"],
    [400, "failed"],
  ])("maps HTTP %s to %s without retrying in the worker", async (code, status) => {
    const { handler, call, fetcher } = setup(
      async () => new Response(null, { status: Number(code) }),
    );
    await handler(request());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      token,
      "finish",
      expect.objectContaining({ p_status: status }),
    );
  });
  it("treats lost responses as uncertain, never auto-replays", async () => {
    const { handler, call, fetcher } = setup(async () => {
      throw new Error("timeout");
    });
    await handler(request());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      token,
      "finish",
      expect.objectContaining({ p_status: "uncertain" }),
    );
  });
  it("rejects missing/invalid token and unsafe endpoint without contacting a provider", async () => {
    const call = vi.fn();
    const fetcher = vi.fn();
    const handler = createSecretaryWorker({ load: async () => null, call, fetcher });
    expect((await handler(new Request("https://example.invalid", { method: "POST" }))).status).toBe(
      401,
    );
    expect((await handler(request())).status).toBe(401);
    const unsafe = createSecretaryWorker({
      load: async () => ({ ...config, baseUrl: "https://other.invalid" }),
      call,
      fetcher,
    });
    expect((await unsafe(request())).status).toBe(503);
    expect(call).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("supports Uazapi message ids", async () => {
    let claimed = false;
    const call = vi.fn(async (_t: string, op: string) =>
      op === "claim" ? (claimed ? null : ((claimed = true), job)) : {},
    );
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ messageid: "uaz-1" })));
    await createSecretaryWorker({
      load: async () => ({ ...config, provider: "uazapi", baseUrl: "https://test.uazapi.com" }),
      call,
      fetcher,
    })(request());
    expect(fetcher).toHaveBeenCalledWith(
      "https://test.uazapi.com/send/text",
      expect.objectContaining({ headers: expect.objectContaining({ token: "fake-only" }) }),
    );
    expect(call).toHaveBeenCalledWith(
      token,
      "finish",
      expect.objectContaining({ p_provider_id: "uaz-1" }),
    );
  });
});
