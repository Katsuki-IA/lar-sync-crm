import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const reportInput = z.object({
  companyId: z.number().int().positive(),
  companyName: z.string().trim().min(1).max(120),
  empreendimentoName: z.string().trim().min(1).max(120),
  typeLabel: z.string().trim().min(1).max(40),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  counts: z.object({
    received: z.number().int().nonnegative(),
    engaged: z.number().int().nonnegative(),
    hot: z.number().int().nonnegative(),
    sentToCrm: z.number().int().nonnegative(),
    scheduled: z.number().int().nonnegative(),
  }),
  imageDataUrl: z.string().startsWith("data:image/png;base64,").max(1_500_000),
});

type CrmUser = { id_empresa: number | null; role: string };

async function getMe(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("crm_users")
    .select("id_empresa,role")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Usuário não cadastrado no CRM.");
  return data as CrmUser;
}

async function responseMessage(response: Response) {
  const text = await response.text();
  if (!text) return "";
  try {
    const payload = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // A resposta do webhook não precisa ser JSON.
  }
  return text.slice(0, 240);
}

/**
 * Entrega a imagem pronta ao webhook do n8n. A chave da Evolution permanece
 * exclusivamente no n8n; o navegador nunca a recebe.
 */
export const sendJourneyFunnelReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => reportInput.parse(data))
  .handler(async ({ data, context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "super_admin" && me.role !== "manager") {
      throw new Error("Sem permissão para enviar o relatório.");
    }
    if (me.role === "manager" && me.id_empresa !== data.companyId) {
      throw new Error("Sem permissão para enviar o relatório de outra empresa.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from("empresa_dados")
      .select("id,id_group")
      .eq("id", data.companyId)
      .maybeSingle();
    if (empresaError) throw new Error(empresaError.message);
    if (!empresa) throw new Error("Empresa não encontrada.");
    if (!empresa.id_group?.trim()) {
      throw new Error("Esta empresa não possui o grupo de WhatsApp configurado.");
    }

    // A rota é deliberadamente longa e não é exposta ao navegador. Em produção,
    // N8N_FUNNEL_REPORT_WEBHOOK_URL pode substituí-la por uma rota própria.
    const defaultWebhookUrl =
      "https://n8n2.katsuki.com.br/webhook/hub-funnel-report-78b84d6b74cc4f8199a39cea5d09beac";
    const webhookUrl = String(process.env.N8N_FUNNEL_REPORT_WEBHOOK_URL ?? defaultWebhookUrl).trim();
    const webhookSecret = String(process.env.N8N_FUNNEL_REPORT_WEBHOOK_SECRET ?? "").trim();
    if (!webhookUrl) throw new Error("O envio de relatório não está configurado no servidor.");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (webhookSecret) headers["x-hub-report-secret"] = webhookSecret;

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        groupId: empresa.id_group,
        report: {
          companyName: data.companyName,
          empreendimentoName: data.empreendimentoName,
          typeLabel: data.typeLabel,
          dateFrom: data.dateFrom,
          dateTo: data.dateTo,
          counts: data.counts,
        },
        imageDataUrl: data.imageDataUrl,
      }),
    });

    if (!response.ok) {
      const detail = await responseMessage(response);
      throw new Error(detail || `O n8n recusou o relatório (${response.status}).`);
    }

    return { ok: true };
  });
