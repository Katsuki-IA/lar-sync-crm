import { describe, expect, it, vi } from "vitest";

// Lovable uses the bun.lock runtime, which supports inputValidator, not validator.
// Reproduce that API so a module-load crash cannot pass unnoticed on newer npm installs.
const { validators } = vi.hoisted(() => ({ validators: [] as ((input: unknown) => unknown)[] }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      inputValidator: (validate: (input: unknown) => unknown) => {
        validators.push(validate);
        return builder;
      },
      handler: () => async () => undefined,
    };
    return builder;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import {
  listReportingIntegrations,
  saveReportingIntegration,
  changeReportingToken,
} from "./reporting.functions";

describe("reporting functions on the deployed runtime", () => {
  it("loads all functions with the inputValidator-only API", () => {
    expect(listReportingIntegrations).toBeTypeOf("function");
    expect(saveReportingIntegration).toBeTypeOf("function");
    expect(changeReportingToken).toBeTypeOf("function");
    expect(validators).toHaveLength(2);
  });
  it("keeps input validation enabled for both mutations", () => {
    expect(() => validators[0]({ nome: "Pulse", empresa_ids: [], expires_at: null })).toThrow();
    expect(() => validators[1]({ id: "invalid", action: "revoke" })).toThrow();
    expect(validators[0]({ nome: "Pulse", empresa_ids: [25], expires_at: null })).toEqual({
      nome: "Pulse",
      empresa_ids: [25],
      expires_at: null,
    });
  });
});
