import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (value: unknown): unknown => value;
    const builder = {
      middleware: () => builder,
      inputValidator: (fn: typeof validate) => { validate = fn; return builder; },
      handler: (fn: (args: unknown) => unknown) => (args: { data: unknown; context: unknown }) =>
        fn({ ...args, data: validate(args.data) }),
    };
    return builder;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
const mocks = vi.hoisted(() => ({ allowed: vi.fn(), modules: vi.fn(), adminFrom: vi.fn() }));
vi.mock("@/hml/company-api", () => ({ companyApi: () => ({ allowed: mocks.allowed, modules: mocks.modules }) }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.adminFrom } }));
import { getLeadReport } from "./lead-report.functions";

async function invoke(role: string, active = true) {
  const builder = { select: () => builder, eq: () => builder,
    maybeSingle: async () => ({ data: { role, active }, error: null }) };
  const call = getLeadReport as unknown as (args: unknown) => Promise<unknown>;
  return call({ data: { companyId: 38, dateFrom: "2026-11-01", dateTo: "2026-11-18" },
    context: { supabase: { from: () => builder }, userId: "sessão-verificada" } });
}

describe("proteções existentes do relatório de leads", () => {
  it("nega perfil não permitido e usuário inativo antes da leitura privilegiada", async () => {
    vi.clearAllMocks();
    await expect(invoke("corretor")).rejects.toThrow("Sem permissão");
    await expect(invoke("super_admin", false)).rejects.toThrow("Sem permissão");
    expect(mocks.allowed).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });
  it("nega empresa fora de companyApi.allowed antes de consultar módulos ou leads", async () => {
    vi.clearAllMocks();
    mocks.allowed.mockResolvedValue([35]);
    await expect(invoke("manager")).rejects.toThrow("Sem acesso a esta empresa");
    expect(mocks.modules).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });
  it("nega módulo atendimento_ia desabilitado antes de consultar leads", async () => {
    vi.clearAllMocks();
    mocks.allowed.mockResolvedValue([38]);
    mocks.modules.mockResolvedValue({ atendimento_ia: false });
    await expect(invoke("analyst")).rejects.toThrow("Atendimento IA não habilitado");
    expect(mocks.modules).toHaveBeenCalledWith(38);
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });
});