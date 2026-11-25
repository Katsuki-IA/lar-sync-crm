import { beforeEach, expect, it, vi } from "vitest";
import { attendanceStage, moveLead } from "./unified-stages";
import type { Contact, Funnel, Stage } from "./modules";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("./modules", () => ({ db: { rpc }, one: (data: unknown) => data }));
const sales: Funnel = { id: 1, module: "crm", id_empresa: 35, nome: "Vendas", is_default: true };
const ia: Funnel = { ...sales, id: 2, module: "ia" };
const first: Stage = { id: 10, id_funnel: 1, nome: "Primeiro", cor: "", ordem: 1 };
const next = { ...first, id: 11, ordem: 2 };
const base = { ...first, id: 21, id_funnel: 2 };
const contact: Contact = {
  id: 3,
  nome: "Contato",
  crm_stage_id: 21,
  crm_assigned_to: null,
  telefone: "",
  email: null,
};
beforeEach(() => rpc.mockReset());
it("places unstaged contacts in the first attendance column", () => {
  expect(attendanceStage(null, [sales, ia], [first, base])).toBe(base);
  expect(attendanceStage(10, [sales, ia], [first, base])).toBeUndefined();
});
it("creates once and moves the returned opportunity using its version", async () => {
  rpc
    .mockResolvedValueOnce({ data: { id: "op", stage_id: first.id, version: 3 } })
    .mockResolvedValueOnce({ data: {} });
  await moveLead(35, contact, next, sales, "user");
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "hub_create_opportunity",
    "hub_move_opportunity",
  ]);
  expect(rpc.mock.calls[1][1]).toEqual({ p_id: "op", p_stage_id: 11, p_expected_version: 3 });
});
it("skips a redundant move and reports partial completion", async () => {
  rpc.mockResolvedValueOnce({ data: { stage_id: 10 } });
  await moveLead(35, contact, first, sales, "user");
  expect(rpc).toHaveBeenCalledTimes(1);
  rpc
    .mockResolvedValueOnce({ data: { id: "op", stage_id: 10, version: 1 } })
    .mockResolvedValueOnce({ error: "conflict" });
  await expect(moveLead(35, contact, next, sales, "user")).rejects.toThrow("Oportunidade criada");
});
