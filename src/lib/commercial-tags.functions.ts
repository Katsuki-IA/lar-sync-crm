import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const saveCommercialTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        companyId: z.number().int().positive(),
        id: z.number().int().positive().nullable(),
        revision: z.number().int().nonnegative().nullable(),
        nome: z.string().trim().min(2).max(80),
        cor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        descricao: z.string().trim().max(300),
        ativo: z.boolean(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const client = context.supabase as unknown as SupabaseClient;
    const role = await client.rpc("crm_current_role");
    if (role.error || !["manager", "gestor", "super_admin"].includes(role.data))
      throw new Error("Somente o gestor pode cadastrar tags comerciais.");
    const result = await client.rpc("hub_save_commercial_tag", {
      p_company_id: data.companyId,
      p_id: data.id,
      p_revision: data.revision,
      p_name: data.nome,
      p_color: data.cor,
      p_description: data.descricao,
      p_active: data.ativo,
    });
    if (result.error)
      throw new Error(
        result.error.code === "23505"
          ? "Já existe uma tag com esse nome nesta empresa."
          : result.error.message,
      );
    return result.data;
  });
