import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sha256Hex } from "@/lib/reporting-utils";

const inputSchema = z.object({
  id: z.string().uuid().optional(),
  nome: z.string().trim().min(2).max(100),
  empresa_ids: z.array(z.number().int().positive().safe()).min(1).max(100),
  expires_at: z.string().datetime().nullable(),
});
const publicFields =
  "id,nome,empresa_ids,token_prefix,expires_at,revoked_at,last_used_at,created_at,updated_at";

function newToken() {
  return `khr_${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export const listReportingIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { reportingDb, requireReportingAdmin } = await import("./reporting-db.server");
    await requireReportingAdmin(context.userId);
    const [integrations, companies] = await Promise.all([
      reportingDb
        .from("crm_reporting_integrations")
        .select(publicFields)
        .order("created_at", { ascending: false }),
      reportingDb.from("empresa_dados").select("id,nome").order("nome"),
    ]);
    if (integrations.error) throw new Error(integrations.error.message);
    if (companies.error) throw new Error(companies.error.message);
    return { integrations: integrations.data ?? [], companies: companies.data ?? [] };
  });

// Keep inputValidator: the Lovable bun.lock runtime predates the validator alias.
export const saveReportingIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { reportingDb, requireReportingAdmin } = await import("./reporting-db.server");
    const creator = await requireReportingAdmin(context.userId);
    if (data.expires_at && Date.parse(data.expires_at) <= Date.now())
      throw new Error("A validade deve estar no futuro");
    const empresaIds = [...new Set(data.empresa_ids)];
    const companies = await reportingDb.from("empresa_dados").select("id").in("id", empresaIds);
    if (companies.error || companies.data?.length !== empresaIds.length)
      throw new Error("Empresa inválida");
    const values = {
      nome: data.nome,
      empresa_ids: empresaIds,
      expires_at: data.expires_at,
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
      const result = await reportingDb
        .from("crm_reporting_integrations")
        .update(values)
        .eq("id", data.id)
        .is("revoked_at", null)
        .select("id")
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new Error("Integração não encontrada ou revogada");
      return { id: result.data.id, token: null as string | null };
    }
    const token = newToken();
    const result = await reportingDb
      .from("crm_reporting_integrations")
      .insert({
        ...values,
        token_hash: await sha256Hex(token),
        token_prefix: token.slice(0, 12),
        created_by: creator,
      })
      .select("id")
      .single();
    if (result.error) throw new Error(result.error.message);
    return { id: result.data.id, token };
  });

export const changeReportingToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), action: z.enum(["rotate", "revoke"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { reportingDb, requireReportingAdmin } = await import("./reporting-db.server");
    await requireReportingAdmin(context.userId);
    const token = data.action === "rotate" ? newToken() : null;
    const now = new Date().toISOString();
    const values = token
      ? { token_hash: await sha256Hex(token), token_prefix: token.slice(0, 12), updated_at: now }
      : { revoked_at: now, updated_at: now };
    const result = await reportingDb
      .from("crm_reporting_integrations")
      .update(values)
      .eq("id", data.id)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error("Integração não encontrada ou revogada");
    return { token };
  });
