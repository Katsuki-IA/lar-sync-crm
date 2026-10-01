import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canManageNegotiation } from "@/lib/negotiation";

const companySchema = z.object({ companyId: z.number().int().positive() });

// Keep inputValidator: the Start runtime deployed by Lovable does not yet expose validator.

async function authorize(supabase: any, userId: string, companyId: number) {
  const { data: me, error } = await supabase
    .from("crm_users")
    .select("role,id_empresa")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!me || !canManageNegotiation(me.role, me.id_empresa, companyId))
    throw new Error("Sem permissão para configurar esta empresa");
}

export const getNegotiationConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => companySchema.parse(input))
  .handler(async ({ context, data }) => {
    await authorize(context.supabase, context.userId, data.companyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [company, projects] = await Promise.all([
      supabaseAdmin
        .from("empresa_dados")
        .select("id,nome,modalidade_negociacao")
        .eq("id", data.companyId)
        .single(),
      supabaseAdmin
        .from("empreendimento")
        .select("id,nome,modalidade_negociacao")
        .eq("id_empresa", data.companyId)
        .order("nome"),
    ]);
    if (company.error) throw new Error(company.error.message);
    if (projects.error) throw new Error(projects.error.message);
    return { company: company.data, projects: projects.data ?? [] };
  });

export const saveNegotiationConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    companySchema
      .extend({
        projectId: z.number().int().positive().optional(),
        mode: z.enum(["venda", "locacao", "ambos"]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await authorize(context.supabase, context.userId, data.companyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = data.projectId
      ? await supabaseAdmin
          .from("empreendimento")
          .update({ modalidade_negociacao: data.mode })
          .eq("id", data.projectId)
          .eq("id_empresa", data.companyId)
          .select("id")
          .single()
      : await supabaseAdmin
          .from("empresa_dados")
          .update({ modalidade_negociacao: data.mode })
          .eq("id", data.companyId)
          .select("id")
          .single();
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  });
