export function getInitials(name?: string | null, fallback = "?"): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || fallback;
}

const AVATAR_COLORS = [
  "#F97316", "#3B82F6", "#8B5CF6", "#10B981", "#EF4444",
  "#F59E0B", "#06B6D4", "#EC4899", "#84CC16", "#6366F1",
];

export function colorFromString(s?: string | null): string {
  if (!s) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** Map common stage names → semantic color. Falls back to provided color or orange. */
export function stageColor(name?: string | null, fallback?: string | null): string {
  const n = (name ?? "").toLowerCase();
  if (/perd/.test(n)) return "#EF4444";
  if (/fech|ganh|venda/.test(n)) return "#10B981";
  if (/propost|corretor/.test(n)) return "#F97316";
  if (/visit/.test(n)) return "#8B5CF6";
  if (/atend/.test(n)) return "#06B6D4";
  if (/contat/.test(n)) return "#F59E0B";
  if (/base/.test(n)) return "#3B82F6";
  return fallback ?? "#F97316";
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "agora";
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d} ${d === 1 ? "dia" : "dias"}`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `há ${mo} ${mo === 1 ? "mês" : "meses"}`;
  const y = Math.floor(d / 365);
  return `há ${y} ${y === 1 ? "ano" : "anos"}`;
}