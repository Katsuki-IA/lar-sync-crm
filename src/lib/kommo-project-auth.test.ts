import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: null as null | { role: string; id_empresa: number | null },
  getUser: vi.fn(),
  companyContext: vi.fn(),
  filters: [] as unknown[][],
}));

vi.mock("../../supabase/functions/_shared/meta.ts", () => ({
  createSupabaseAdmin: () => ({
    auth: { getUser: mocks.getUser },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: (...args: unknown[]) => { mocks.filters.push(args); return query; },
        maybeSingle: async () => ({ data: mocks.profile, error: null }),
        order: () => query,
        limit: async () => ({ data: [], error: null }),
      };
      expect(["crm_users", "crm_kommo_project_sync"]).toContain(table);
      return query;
    },
  }),
  handleOptions: () => null,
  jsonResponse: (body: unknown, status = 200) => Response.json(body, { status }),
  withErrorHandling: async (handler: () => Promise<Response>) => handler(),
}));
vi.mock("../../supabase/functions/_shared/kommo-projects.ts", async (importOriginal) => ({
  ...await importOriginal<object>(),
  companyContext: mocks.companyContext,
  loadConfig: async () => null,
}));

let handler: (request: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal("Deno", { serve: (fn: typeof handler) => { handler = fn; } });
  const endpoint = "../../supabase/functions/kommo-project-config/index.ts";
  await import(endpoint);
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.filters = [];
  mocks.profile = null;
  mocks.getUser.mockResolvedValue({ data: { user: { id: "verified-user" } }, error: null });
  mocks.companyContext.mockResolvedValue({ api: { base: "https://test.kommo.com" }, projects: [] });
});

const request = (token = "valid-token") => handler(new Request("https://example.test", {
  method: "POST",
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body: JSON.stringify({ companyId: 9, action: "status" }),
}));

describe("Kommo configuration authorization", () => {
  it("allows a global administrator without a company to view the selected company", async () => {
    mocks.profile = { role: "super_admin", id_empresa: null };
    expect((await request()).status).toBe(200);
    expect(mocks.getUser).toHaveBeenCalledWith("valid-token");
    expect(mocks.filters).toContainEqual(["auth_user_id", "verified-user"]);
    expect(mocks.filters).toContainEqual(["active", true]);
    expect(mocks.companyContext).toHaveBeenCalledWith(expect.anything(), 9);
  });
  it("allows managers of the selected company", async () => {
    mocks.profile = { role: "manager", id_empresa: 9 };
    expect((await request()).status).toBe(200);
  });
  it.each([
    { role: "manager", id_empresa: 8 },
    { role: "manager", id_empresa: null },
    { role: "agent", id_empresa: 9 },
    null,
  ])("rejects unauthorized CRM profiles: %j", async (profile) => {
    mocks.profile = profile;
    expect((await request()).status).toBe(403);
    expect(mocks.companyContext).not.toHaveBeenCalled();
  });
  it("rejects missing authentication before accessing the company", async () => {
    expect((await request("")).status).toBe(401);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.companyContext).not.toHaveBeenCalled();
  });
  it("rejects invalid sessions even with a global administrator profile", async () => {
    mocks.profile = { role: "super_admin", id_empresa: null };
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid") });
    expect((await request()).status).toBe(401);
    expect(mocks.companyContext).not.toHaveBeenCalled();
  });
});
