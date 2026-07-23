import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type CrmUser = {
  id_empresa: number | null;
  role: string;
};

async function getMe(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("crm_users")
    .select("id_empresa,role")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Usuário não cadastrado no CRM");
  return data as CrmUser;
}

async function parseResponsePayload(response: Response) {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export const sendLeadToExternalCrm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ lead_id: z.number().int().positive() }).parse(d))
  .handler(async ({ data, context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "super_admin" && me.role !== "manager") {
      throw new Error("Sem permissão para enviar lead ao CRM.");
    }

    const request = getRequest();
    const authHeader = request?.headers.get("authorization") ?? "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";
    if (!accessToken) throw new Error("Não foi possível validar a sessão atual para enviar o lead ao CRM.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: lead, error: leadError } = await supabaseAdmin
      .from("crm_leads")
      .select("id,id_empresa")
      .eq("id", data.lead_id)
      .maybeSingle();
    if (leadError) throw new Error(leadError.message);
    if (!lead) throw new Error("Lead não encontrado.");
    if (me.role === "manager" && me.id_empresa !== lead.id_empresa) {
      throw new Error("Sem permissão para enviar lead de outra empresa.");
    }

    const supabaseUrl = String(process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
    if (!supabaseUrl) throw new Error("SUPABASE_URL ausente para enviar o lead ao CRM.");

    const response = await fetch(`${supabaseUrl}/functions/v1/external-crms-dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ leadId: lead.id, idEmpresa: lead.id_empresa }),
    });
    const payload = await parseResponsePayload(response);
    if (!response.ok) {
      const message =
        (typeof payload?.error === "string" && payload.error) ||
        (typeof payload?.message === "string" && payload.message) ||
        `Envio ao CRM retornou ${response.status}`;
      throw new Error(message);
    }

    return payload;
  });
