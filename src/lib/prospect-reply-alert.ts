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