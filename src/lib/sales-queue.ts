export type QueueRules = {
  development_id: number | null;
  trigger_qualified: boolean;
  trigger_stage_ids: number[];
  schedule_enabled: boolean;
  weekdays: number[];
  starts_at: string;
  ends_at: string;
  priority: number;
};
export type SalesQueue = Partial<QueueRules> & {
  id: string;
  name: string;
  active: boolean;
  timeout_minutes: number;
  revision: number;
  cursor_position?: number;
};
export type QueueMember = { id: string; nome: string; active: boolean; role: string };
export type QueueMembership = {
  queue_id: string;
  member_id: string;
  position: number;
  paused?: boolean;
};
export type SalesDistribution = {
  id: string;
  queue_id: string;
  opportunity_id: string;
  status: string;
  created_at: string;
};
export type SalesOffer = {
  id: string;
  distribution_id: string;
  member_id: string;
  opportunity_title: string;
  status: string;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
};
export type QueueOverview = {
  installed: boolean;
  pending: (SalesOffer & { queue_id: string })[];
  stats: {
    queue_id: string;
    member_id: string;
    received: number;
    accepted: number;
    mean_minutes: number | null;
  }[];
  waiting: {
    opportunity_id: string;
    title: string;
    lead_name: string;
    created_at: string;
    next_attempt_at: string;
    reason: string;
  }[];
};
export const defaultQueueRules: QueueRules = {
  development_id: null,
  trigger_qualified: false,
  trigger_stage_ids: [],
  schedule_enabled: false,
  weekdays: [1, 2, 3, 4, 5],
  starts_at: "08:00",
  ends_at: "18:00",
  priority: 100,
};
export const weekdays = [
  { id: 1, label: "Seg" },
  { id: 2, label: "Ter" },
  { id: 3, label: "Qua" },
  { id: 4, label: "Qui" },
  { id: 5, label: "Sex" },
  { id: 6, label: "Sáb" },
  { id: 7, label: "Dom" },
];
export function isQueueAgent(m: QueueMember) {
  return ["agent", "corretor"].includes(m.role);
}
export function queueSchedule(q: Partial<QueueRules>) {
  return !q.schedule_enabled
    ? "Todos os dias · 24 horas"
    : `${weekdays
        .filter((d) => q.weekdays?.includes(d.id))
        .map((d) => d.label)
        .join(", ")} · ${q.starts_at?.slice(0, 5)}–${q.ends_at?.slice(0, 5)}`;
}
export function offerRemaining(expires: string, now = Date.now()) {
  const ms = new Date(expires).getTime() - now;
  return ms <= 0 ? "Prazo encerrado" : `${Math.ceil(ms / 60000)} min restantes`;
}
export function nextQueueMember(
  q: SalesQueue,
  members: QueueMember[],
  membership: QueueMembership[],
) {
  const eligible = membership
    .filter(
      (m) =>
        m.queue_id === q.id &&
        !m.paused &&
        members.some((u) => u.id === m.member_id && u.active && isQueueAgent(u)),
    )
    .sort((a, b) => a.position - b.position);
  return (eligible.find((m) => m.position > (q.cursor_position ?? 0)) ?? eligible[0])?.member_id;
}
