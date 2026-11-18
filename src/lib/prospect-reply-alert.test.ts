import { describe, expect, it, vi } from "vitest";
import { isProspectNoticeRecipient, loadProspectNotices } from "./prospect-reply-alert";

const ana = { id: "36ac39f5-27e6-45aa-a28c-42de74836395", active: true };

describe("aviso de interesse exclusivo de Ana Katsuki", () => {
  it("consulta avisos para Ana ativa", async () => {
    const fetchNotices = vi.fn().mockResolvedValue([{ id: "notice-1" }]);
    expect(isProspectNoticeRecipient(ana)).toBe(true);
    expect(await loadProspectNotices(ana, fetchNotices)).toEqual([{ id: "notice-1" }]);
    expect(fetchNotices).toHaveBeenCalledOnce();
  });

  it.each([
    ["outro usuário ativo", { id: "outro-usuario", active: true }],
    ["Ana inativa", { ...ana, active: false }],
    ["Ana sem confirmação de atividade", { ...ana, active: null }],
    ["usuário ausente", null],
    ["usuário ainda carregando", undefined],
  ])("não consulta RPC para %s", async (_label, user) => {
    const fetchNotices = vi.fn().mockResolvedValue([]);
    expect(isProspectNoticeRecipient(user)).toBe(false);
    expect(await loadProspectNotices(user, fetchNotices)).toEqual([]);
    expect(fetchNotices).not.toHaveBeenCalled();
  });
});
import { dismissProspectNoticesUntil as dismissAll } from "./prospect-reply-alert";
describe("fechar todos os avisos", () => {
  const mk = (i: number, t: number) => ({ id: `n${i}`, company_id: 35, company_name: "P1", lead_id: i, lead_name: `L${i}`, created_at: new Date(t).toISOString() });
  it("fecha em lotes de 100 até o clique e preserva avisos novos", async () => {
    const cutoff = 1_000_000;
    let pending = [...Array.from({ length: 230 }, (_, i) => mk(i, cutoff - 1000 + i)), mk(999, cutoff + 5)];
    const seen: string[] = [];
    const r = await dismissAll(cutoff, async () => pending.slice(0, 100), async id => { seen.push(id); pending = pending.filter(n => n.id !== id); return true; });
    expect(r).toEqual({ closed: 230, failed: 0 });
    expect(seen).not.toContain("n999");
    expect(pending.map(n => n.id)).toEqual(["n999"]);
  });
  it("erro parcial é informado e mantém pendentes", async () => {
    let pending = [mk(1, 1), mk(2, 2), mk(3, 3)];
    const r = await dismissAll(10, async () => pending, async id => {
      if (id === "n2") throw new Error("falha");
      pending = pending.filter(n => n.id !== id); return true;
    });
    expect(r).toEqual({ closed: 2, failed: 1 });
    expect(pending.map(n => n.id)).toEqual(["n2"]);
  });
  it("resposta não confirmada conta como falha", async () => {
    const r = await dismissAll(10, async () => [mk(1, 1)], async () => false);
    expect(r).toEqual({ closed: 0, failed: 1 });
  });
});
