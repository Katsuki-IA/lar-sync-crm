export function getInitials(name?: string | null, fallback = "?"): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || fallback;
}

const AVATAR_COLORS = [
  "#C14F21", "#E68F6A", "#F2B9A3", "#2D7D52", "#C0392B",
  "#B07D1A", "#2471A3", "#7A3115", "#D96D3E", "#A3421C",
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
  if (/perd/.test(n)) return "#C0392B";
  if (/fech|ganh|venda/.test(n)) return "#2D7D52";
  if (/propost|corretor/.test(n)) return "#C14F21";
  if (/visit/.test(n)) return "#7A3115";
  if (/atend/.test(n)) return "#2471A3";
  if (/contat/.test(n)) return "#B07D1A";
  if (/base/.test(n)) return "#E68F6A";
  return fallback ?? "#C14F21";
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