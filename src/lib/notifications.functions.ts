import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getMe(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("crm_users")
    .select("id,id_empresa,role")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Usuário não cadastrado no CRM");
  return data as { id: string; id_empresa: number | null; role: string };
}

// Enviar notificação (super_admin)
export const sendNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        titulo: z.string().min(1).max(120),
        mensagem: z.string().min(1).max(1000),
        link: z.string().url().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
        all_empresas: z.boolean().default(false),
        empresa_ids: z.array(z.number()).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "super_admin") throw new Error("Apenas super admin pode enviar notificações");
    if (!data.all_empresas && data.empresa_ids.length === 0) {
      throw new Error("Selecione ao menos uma empresa ou marque 'todas as empresas'");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: notif, error } = await supabaseAdmin
      .from("crm_notifications")
      .insert({
        titulo: data.titulo,
        mensagem: data.mensagem,
        link: data.link ?? null,
        all_empresas: data.all_empresas,
        created_by: me.id,
      })
      .select("id")
      .single();
    if (error || !notif) throw new Error(error?.message ?? "Falha ao criar notificação");

    let targets: number[] = [];
    if (data.all_empresas) {
      const { data: creds } = await supabaseAdmin
        .from("credentials")
        .select("id_empresa")
        .eq("default_crm", "hub");
      targets = (creds ?? [])
        .map((c: any) => c.id_empresa as number | null)
        .filter((v: number | null): v is number => v != null);
    } else {
      targets = data.empresa_ids;
    }
    if (targets.length) {
      await supabaseAdmin
        .from("crm_notification_targets")
        .insert(targets.map((id_empresa) => ({ notification_id: notif.id, id_empresa })));
    }
    return { ok: true, id: notif.id, recipients: targets.length };
  });

// Listar notificações enviadas (super_admin)
export const listSentNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "super_admin") throw new Error("Sem permissão");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("crm_notifications")
      .select("id,titulo,mensagem,link,all_empresas,created_at,crm_notification_targets(id_empresa)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []).map((n: any) => ({
      id: n.id,
      titulo: n.titulo,
      mensagem: n.mensagem,
      link: n.link,
      all_empresas: n.all_empresas,
      created_at: n.created_at,
      empresa_ids: (n.crm_notification_targets ?? []).map((t: any) => t.id_empresa as number),
    }));
  });

// Excluir notificação (super_admin)
export const deleteNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "super_admin") throw new Error("Sem permissão");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("crm_notifications").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
