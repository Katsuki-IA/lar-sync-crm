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
        .select("id,nome,modalidade_negociacao,c2s_fila_venda_id,c2s_fila_locacao_id")
        .eq("id", data.companyId)
        .single(),
      supabaseAdmin
        .from("empreendimento")
        .select("id,nome,modalidade_negociacao,c2s_fila_venda_id,c2s_fila_locacao_id")
        .eq("id_empresa", data.companyId)
        .order("nome"),
    ]);
    if (company.error) throw new Error(company.error.message);
    if (projects.error) throw new Error(projects.error.message);
    return { company: company.data, projects: projects.data ?? [] };
  });

export const saveC2sQueues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    companySchema
      .extend({
        projectId: z.number().int().positive().optional(),
        saleQueue: z.number().int().positive().nullable(),
        rentalQueue: z.number().int().positive().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await authorize(context.supabase, context.userId, data.companyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: credentials, error } = await supabaseAdmin
      .from("credentials")
      .select("c2s_crm_url,c2s_crm_token")
      .eq("id_empresa", data.companyId)
      .single();
    if (error) throw new Error(error.message);
    const ids = [data.saleQueue, data.rentalQueue].filter((id) => id !== null);
    if (ids.length) {
      if (!credentials?.c2s_crm_url || !credentials.c2s_crm_token)
        throw new Error("C2S não configurado nesta empresa");
      const queues: { id: number; status: string }[] = [];
      for (let page = 1; page <= 20; page++) {
        const response = await fetch(
          `${credentials.c2s_crm_url.replace(/\/+$/, "")}/distribution_queues/list_queues?per_page=100&page=${page}`,
          {
            headers: { Authorization: `Bearer ${credentials.c2s_crm_token}` },
            signal: AbortSignal.timeout(10000),
          },
        );
        if (!response.ok) throw new Error("Não foi possível validar as filas no C2S");
        const result = await response.json();
        if (result.success !== true || !Array.isArray(result.distribution_queues))
          throw new Error("Resposta inválida ao consultar as filas C2S");
        queues.push(...result.distribution_queues);
        if (page >= Number(response.headers.get("total-pages") || 1)) break;
      }
      if (
        ids.some(
          (id) => !queues.some((queue) => Number(queue.id) === id && queue.status === "enabled"),
        )
      )
        throw new Error("Escolha uma fila ativa desta empresa no C2S");
    }
    const values = { c2s_fila_venda_id: data.saleQueue, c2s_fila_locacao_id: data.rentalQueue };
    const result = data.projectId
      ? await supabaseAdmin
          .from("empreendimento")
          .update(values)
          .eq("id", data.projectId)
          .eq("id_empresa", data.companyId)
          .select("id")
          .single()
      : await supabaseAdmin
          .from("empresa_dados")
          .update(values)
          .eq("id", data.companyId)
          .select("id")
          .single();
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
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
