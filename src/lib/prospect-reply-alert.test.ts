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