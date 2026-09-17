import { describe, expect, it, vi } from "vitest";
import { handleReportingRequest } from "./reporting-api.server";

const token = `khr_${"a".repeat(64)}`;
const url =
  "https://hub.example/api/integrations/leads?id_empresa=25&data_inicio=2026-09-09&data_fim=2026-09-15";
const request = (target = url) =>
  new Request(target, { headers: { Authorization: `Bearer ${token}` } });
const identity = { integration_id: "test", empresa_ids: [25], rate_allowed: true };

describe("reporting API access boundary", () => {
  it("accepts the header credential and queries only its allowed tenant", async () => {
    const authorize = vi.fn().mockResolvedValue(identity);
    const query = vi.fn().mockResolvedValue({ leads: [] });
    const response = await handleReportingRequest(request(), { authorize, query });
    expect(response.status).toBe(200);
    expect(authorize.mock.calls[0][0]).toMatch(/^[0-9a-f]{64}$/);
    expect(authorize.mock.calls[0][0]).not.toContain(token);
    expect(query.mock.calls[0][0].id_empresa).toBe(25);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("does not accept a token in the URL", async () => {
    const authorize = vi.fn();
    const query = vi.fn();
    expect(
      (await handleReportingRequest(new Request(`${url}&token=${token}`), { authorize, query }))
        .status,
    ).toBe(401);
    expect(authorize).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
  it("blocks a tenant change before accessing leads", async () => {
    const query = vi.fn();
    expect(
      (
        await handleReportingRequest(request(url.replace("25", "9")), {
          authorize: async () => identity,
          query,
        })
      ).status,
    ).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
  it("blocks revoked/expired credentials and rate-limited credentials", async () => {
    const query = vi.fn();
    expect(
      (await handleReportingRequest(request(), { authorize: async () => null, query })).status,
    ).toBe(401);
    const limited = await handleReportingRequest(request(), {
      authorize: async () => ({ ...identity, rate_allowed: false }),
      query,
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects malformed dates and does not expose database errors", async () => {
    const query = vi.fn().mockRejectedValue(new Error("secret-internal-details"));
    const invalid = await handleReportingRequest(request(url.replace("2026-09-09", "2026-02-30")), {
      authorize: async () => identity,
      query,
    });
    expect(invalid.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    const response = await handleReportingRequest(request(), {
      authorize: async () => identity,
      query,
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret-internal-details");
  });
});
