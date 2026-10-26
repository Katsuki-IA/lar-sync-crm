import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const id = z.number().int().positive();
const destination = z.object({ funnel_id: id, stage_id: id }).strict();
const values = z
  .object({
    nome: z.string().trim().min(2).max(120),
    ordem: z.number().int().min(0).max(10000),
    ativo: z.boolean(),
    cor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    id_funnel: id.optional(),
    replacement_id: id.nullable().optional(),
  })
  .strict();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), companyId: id }).strict(),
  z
    .object({
      action: z.literal("definition"),
      companyId: id,
      kind: z.enum(["stage", "funnel"]),
      id: id.nullable(),
      revision: z.number().int().nonnegative().nullable(),
      values,
    })
    .strict(),
  z
    .object({
      action: z.literal("destination"),
      companyId: id,
      revision: z.number().int().nonnegative(),
      enabled: z.boolean(),
      destinations: z
        .object({
          unqualified: destination.optional(),
          qualified: destination.optional(),
          visit: destination.optional(),
          lost: destination.optional(),
          without_whatsapp: destination.optional(),
          blocked_send: destination.optional(),
        })
        .strict(),
    })
    .strict(),
]);
export const commercialSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((x) => schema.parse(x))
  .handler(async ({ data, context }) => {
    const client = context.supabase as unknown as SupabaseClient;
    const role = await client.rpc("crm_current_role");
    if (role.error || !["manager", "gestor", "super_admin"].includes(role.data))
      throw new Error("Acesso restrito ao gestor");
    if (data.action === "destination" && role.data !== "super_admin")
      throw new Error("Somente super admin altera o destino");
    const result =
      data.action === "read"
        ? await client.rpc("hub_commercial_config", { p_company_id: data.companyId })
        : data.action === "definition"
          ? await client.rpc("hub_save_commercial_definition", {
              p_company_id: data.companyId,
              p_kind: data.kind,
              p_id: data.id,
              p_revision: data.revision,
              p_data: data.values,
            })
          : await client.rpc("hub_save_internal_crm", {
              p_company_id: data.companyId,
              p_revision: data.revision,
              p_enabled: data.enabled,
              p_destinations: data.destinations,
            });
    if (result.error) {
      if (data.action === "read" && ["42883", "PGRST202"].includes(result.error.code))
        return { installed: false };
      throw new Error(result.error.message);
    }
    return { installed: true, ...(data.action === "read" ? result.data : {}) };
  });
