import { describe, expect, it } from "vitest";
import { offerCountdown, pendingOwnOffers } from "./offer-alert";
import type { SalesOffer } from "./sales-queue";

const now = Date.parse("2026-10-27T12:00:00Z");
const offer = (id: string, seconds: number, overrides: Partial<SalesOffer> = {}): SalesOffer => ({
  id,
  member_id: "agent-a",
  distribution_id: id,
  opportunity_title: "Lead teste",
  status: "pending",
  expires_at: new Date(now + seconds * 1000).toISOString(),
  created_at: new Date(now).toISOString(),
  resolved_at: null,
  ...overrides,
});

describe("global offer alert", () => {
  it("never shows another agent's offers, resolved offers, expired offers or invalid deadlines", () => {
    const rows = [
      offer("own", 60),
      offer("other", 60, { member_id: "agent-b" }),
      offer("accepted", 60, { status: "accepted" }),
      offer("declined", 60, { status: "declined" }),
      offer("cancelled", 60, { status: "cancelled" }),
      offer("expired", -1),
      offer("boundary", 0),
      offer("invalid", 60, { expires_at: "invalid" }),
    ];
    expect(pendingOwnOffers(rows, "agent-a", now).map((o) => o.id)).toEqual(["own"]);
  });

  it("prioritizes the nearest deadline without changing the cached array", () => {
    const rows = [offer("later", 90), offer("first", 10)];
    expect(pendingOwnOffers(rows, "agent-a", now).map((o) => o.id)).toEqual(["first", "later"]);
    expect(rows.map((o) => o.id)).toEqual(["later", "first"]);
    expect(pendingOwnOffers(rows, "agent-a", now + 10000).map((o) => o.id)).toEqual(["later"]);
  });

  it("uses the absolute deadline after a suspended tab resumes", () => {
    const deadline = offer("one", 600).expires_at;
    expect(offerCountdown(deadline, now)).toBe("10:00");
    expect(offerCountdown(deadline, now + 19000)).toBe("09:41");
    expect(offerCountdown(deadline, now + 599001)).toBe("00:01");
    expect(offerCountdown(deadline, now + 600000)).toBe("00:00");
    expect(offerCountdown(deadline, now + 900000)).toBe("00:00");
  });
});
