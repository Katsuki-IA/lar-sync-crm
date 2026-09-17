import { z } from "zod";

export const reportingQuerySchema = z
  .object({
    id_empresa: z.coerce.number().int().positive().safe(),
    data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fuso: z.enum(["America/Sao_Paulo", "UTC"]).default("America/Sao_Paulo"),
    limite: z.coerce.number().int().min(1).max(100).default(50),
    antes_de_id: z.coerce.number().int().positive().safe().optional(),
  })
  .strict();

export function reportPeriod(from: string, to: string, timezone: "America/Sao_Paulo" | "UTC") {
  for (const date of [from, to]) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error("Data inválida; use YYYY-MM-DD");
    }
  }
  if (from > to) throw new Error("data_inicio deve ser anterior ou igual a data_fim");
  // This reporting API supports modern Brazilian dates, after the end of DST.
  if (timezone === "America/Sao_Paulo" && from < "2020-01-01") {
    throw new Error("Para períodos anteriores a 2020, use fuso=UTC");
  }
  const offset = timezone === "UTC" ? "Z" : "-03:00";
  const start = new Date(`${from}T00:00:00${offset}`);
  const end = new Date(new Date(`${to}T00:00:00${offset}`).getTime() + 86_400_000);
  if (end.getTime() - start.getTime() > 366 * 86_400_000) {
    throw new Error("Consulte no máximo 366 dias por período");
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

export type Attribution = {
  source_type: string;
  meta_ad_id: string | null;
  meta_leadgen_id?: string | null;
  created_at: string;
};

export function chooseAttribution<T extends Attribution>(rows: T[]): T | null {
  const score = (row: T) => (row.meta_ad_id ? 2 : row.meta_leadgen_id ? 1 : 0);
  return (
    [...rows].sort((a, b) => score(b) - score(a) || b.created_at.localeCompare(a.created_at))[0] ??
    null
  );
}

export function normalizeReportPhone(value: string | null | undefined) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function reportPersonKey(phone: string | null | undefined) {
  const normalized = normalizeReportPhone(phone);
  return normalized ? `phone_v1_${await sha256Hex(`phone:v1:${normalized}`)}` : null;
}

export function cvIdFromResponse(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const dispatch =
    record.dispatch && typeof record.dispatch === "object" && !Array.isArray(record.dispatch)
      ? (record.dispatch as Record<string, unknown>)
      : record;
  for (const candidate of [dispatch.idlead, dispatch.id_lead, dispatch.id]) {
    const id = String(candidate ?? "").trim();
    if (/^[1-9][0-9]*$/.test(id)) return id;
  }
  return null;
}
