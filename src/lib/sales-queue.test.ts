import { describe, it, expect } from "vitest";
import { nextQueueMember, queueSchedule, offerRemaining } from "./sales-queue";
describe("apresentação de filas", () => {
  it("rodízio pula pausados/inativos, respeita cursor e volta ao início", () => {
    const q = {
      id: "q",
      name: "Q",
      active: true,
      revision: 1,
      timeout_minutes: 10,
      cursor_position: 1,
    };
    const members = [
      { id: "a", nome: "A", active: true, role: "corretor" },
      { id: "b", nome: "B", active: true, role: "agent" },
    ];
    const memberships = [
      { queue_id: "q", member_id: "a", position: 1 },
      { queue_id: "q", member_id: "b", position: 2 },
    ];
    expect(nextQueueMember(q, members, memberships)).toBe("b");
    expect(nextQueueMember(q, members, [memberships[0], { ...memberships[1], paused: true }])).toBe(
      "a",
    );
    expect(
      nextQueueMember(
        q,
        members.map((m) => ({ ...m, active: false })),
        memberships,
      ),
    ).toBeUndefined();
  });
  it("prazo expirado nunca aparece com minutos negativos", () => {
    expect(offerRemaining("2026-10-24T00:00:00Z", Date.parse("2026-10-25"))).toBe(
      "Prazo encerrado",
    );
  });
  it("apresenta dias e horário sem confundir com prazo de aceite", () => {
    expect(
      queueSchedule({
        schedule_enabled: true,
        weekdays: [1, 5],
        starts_at: "08:00:00",
        ends_at: "18:00:00",
      }),
    ).toBe("Seg, Sex · 08:00–18:00");
  });
});
