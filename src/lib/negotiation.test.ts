import { describe, expect, it } from "vitest";
import { canManageNegotiation, NEGOTIATION_OPTIONS, negotiationLabel } from "./negotiation";

describe("negotiation configuration permissions", () => {
  it("allows managers only within their company", () => {
    expect(canManageNegotiation("manager", 29, 29)).toBe(true);
    expect(canManageNegotiation("manager", 29, 7)).toBe(false);
    expect(canManageNegotiation("manager", null, 29)).toBe(false);
  });
  it("allows super admins and blocks operational/read-only roles", () => {
    expect(canManageNegotiation("super_admin", null, 29)).toBe(true);
    for (const role of ["agent", "analyst", "ai_agent", ""])
      expect(canManageNegotiation(role, 29, 29)).toBe(false);
  });
  it("uses stable stored values and Portuguese labels", () => {
    expect(NEGOTIATION_OPTIONS.map((option) => option.value)).toEqual([
      "venda",
      "locacao",
      "ambos",
    ]);
    expect(negotiationLabel("locacao")).toBe("Locação");
  });
});
