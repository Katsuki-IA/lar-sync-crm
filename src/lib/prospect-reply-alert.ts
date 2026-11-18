import type { CrmUser } from "@/hooks/use-crm-user";

type Recipient = Pick<CrmUser, "id" | "active">;

export type ProspectNotice = {
  id: string;
  company_id: number;
  company_name: string;
  lead_id: number;
  lead_name: string;
  created_at: string;
};

export function isProspectNoticeRecipient(user: Recipient | null | undefined): boolean {
  return user?.active === true && user.id === "36ac39f5-27e6-45aa-a28c-42de74836395";
}

export async function loadProspectNotices(
  user: Recipient | null | undefined,
  fetchNotices: () => Promise<ProspectNotice[]>,
): Promise<ProspectNotice[]> {
  if (!isProspectNoticeRecipient(user)) return [];
  return fetchNotices();
}
export type DismissAllResult = { closed: number; failed: number };

/**
 * Marks as seen every pending notice created up to `cutoffMs` (the click instant).
 * hub_kp_notices returns at most 100 rows ordered by created_at, so we re-fetch
 * until a page has no eligible notice. Newer notices are never touched. Stops on
 * the first failing batch so partial failures are reported, never hidden.
 */
export async function dismissProspectNoticesUntil(
  cutoffMs: number,
  fetchNotices: () => Promise<ProspectNotice[]>,
  markSeen: (id: string) => Promise<boolean>,
  maxRounds = 50,
): Promise<DismissAllResult> {
  let closed = 0;
  const done = new Set<string>();
  for (let round = 0; round < maxRounds; round++) {
    const eligible = (await fetchNotices()).filter(
      n => !done.has(n.id) && Date.parse(n.created_at) <= cutoffMs,
    );
    if (!eligible.length) return { closed, failed: 0 };
    const results = await Promise.allSettled(eligible.map(n => markSeen(n.id)));
    let failed = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value === true) { closed++; done.add(eligible[i].id); }
      else failed++;
    });
    if (failed) return { closed, failed };
  }
  return { closed, failed: 1 };
}
