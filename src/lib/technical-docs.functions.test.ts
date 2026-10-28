import { describe, expect, it, vi } from "vitest";
import { configNavFor } from "./config-nav";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ middleware: () => ({ handler: (handler: unknown) => handler }) }),
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
const { getTechnicalDocs } = await import("./technical-docs.functions");
const invoke = getTechnicalDocs as unknown as (args: { context: unknown }) => Promise<unknown>;

function context(data: unknown, error: unknown = null) {
  const eq = vi.fn(() => ({ maybeSingle: async () => ({ data, error }) }));
  return {
    userId: "verified-auth-user",
    supabase: { from: () => ({ select: () => ({ eq }) }) },
    eq,
  };
}

describe("documentação técnica restrita", () => {
  it.each(["manager", "agent", "analyst", "ai_agent", null])(
    "nega papel %s mesmo com sessão",
    async (role) => {
      await expect(invoke({ context: context({ role, active: true }) })).rejects.toThrow(
        "super admin ativo",
      );
      expect(configNavFor(role).some((item) => item.to === "/admin/documentacao-tecnica")).toBe(
        false,
      );
    },
  );
  it.each([false, null, undefined])("nega super admin com active=%s", async (active) => {
    await expect(invoke({ context: context({ role: "super_admin", active }) })).rejects.toThrow();
  });
  it("falha fechado quando usuário não existe ou banco falha", async () => {
    await expect(invoke({ context: context(null) })).rejects.toThrow();
    await expect(
      invoke({ context: context({ role: "super_admin", active: true }, new Error("db")) }),
    ).rejects.toThrow();
  });
  it("consulta a identidade autenticada e entrega conteúdo ao super admin ativo", async () => {
    const ctx = context({ role: "super_admin", active: true });
    const result = await invoke({ context: ctx });
    expect(ctx.eq).toHaveBeenCalledWith("auth_user_id", "verified-auth-user");
    expect(result).toMatchObject({ reviewedAt: "28/10/2026", sections: expect.any(Array) });
    expect(
      configNavFor("super_admin").some((item) => item.to === "/admin/documentacao-tecnica"),
    ).toBe(true);
  });
});
