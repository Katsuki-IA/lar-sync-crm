import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  generateTemporaryPassword,
  getPasswordPolicyError,
  PASSWORD_POLICY_MESSAGE,
} from "@/lib/password-policy";

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

// -------- Criar usuário CRM (gestor cria na própria empresa; super_admin em qualquer) --------
export const createCrmUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        nome: z.string().min(2),
        email: z.string().email(),
        role: z.enum(["agent", "manager", "super_admin"]),
        id_empresa: z.number().optional(),
        password: z
          .string()
          .refine((password) => !getPasswordPolicyError(password), PASSWORD_POLICY_MESSAGE)
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "manager" && me.role !== "super_admin") {
      throw new Error("Apenas gestores podem criar usuários");
    }
    let targetEmpresa = data.id_empresa ?? me.id_empresa;
    if (me.role === "manager") {
      targetEmpresa = me.id_empresa;
      if (data.role === "super_admin") throw new Error("Gestor não pode criar super admin");
    }
    if (!targetEmpresa && data.role !== "super_admin") throw new Error("Empresa obrigatória");

    const password = data.password ?? generateTemporaryPassword();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (authErr || !authData.user) throw new Error(authErr?.message ?? "Falha ao criar usuário");

    const { error: insErr } = await supabaseAdmin.from("crm_users").insert({
      auth_user_id: authData.user.id,
      id_empresa: targetEmpresa,
      nome: data.nome,
      email: data.email,
      role: data.role,
      active: true,
    });
    if (insErr) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw new Error(insErr.message);
    }
    return { ok: true, password };
  });

// -------- Resetar senha temporária --------
export const resetCrmUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "manager" && me.role !== "super_admin") throw new Error("Sem permissão");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target, error: tErr } = await supabaseAdmin
      .from("crm_users")
      .select("auth_user_id,id_empresa")
      .eq("id", data.user_id)
      .maybeSingle();
    if (tErr || !target) throw new Error("Usuário não encontrado");
    if (me.role === "manager" && target.id_empresa !== me.id_empresa) throw new Error("Sem permissão");
    if (!target.auth_user_id) throw new Error("Usuário sem auth vinculado");
    const password = generateTemporaryPassword();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(target.auth_user_id, { password });
    if (error) throw new Error(error.message);
    return { ok: true, password };
  });

// -------- Ativar/desativar usuário --------
export const setCrmUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "manager" && me.role !== "super_admin") throw new Error("Sem permissão");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin
      .from("crm_users")
      .select("id_empresa")
      .eq("id", data.user_id)
      .maybeSingle();
    if (!target) throw new Error("Usuário não encontrado");
    if (me.role === "manager" && target.id_empresa !== me.id_empresa) throw new Error("Sem permissão");
    const { error } = await supabaseAdmin
      .from("crm_users")
      .update({ active: data.active })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Listar todas empresas (super admin) --------
export const listEmpresas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "super_admin") throw new Error("Sem permissão");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: creds } = await supabaseAdmin
      .from("credentials")
      .select("id_empresa")
      .eq("default_crm", "katsuki");
    const allowed = (creds ?? [])
      .map((c: any) => c.id_empresa as number | null)
      .filter((v: number | null): v is number => v != null);
    if (!allowed.length) return [];
    const { data, error } = await supabaseAdmin
      .from("empresa_dados")
      .select("id,nome,created_at")
      .in("id", allowed)
      .order("id", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: counts } = await supabaseAdmin
      .from("crm_users")
      .select("id_empresa")
      .in("id_empresa", allowed);
    const tally = new Map<number, number>();
    (counts ?? []).forEach((u: any) => {
      if (u.id_empresa != null) tally.set(u.id_empresa, (tally.get(u.id_empresa) ?? 0) + 1);
    });
    return (data ?? []).map((e: any) => ({ ...e, total_usuarios: tally.get(e.id) ?? 0 }));
  });

// -------- Listar todos usuários (super admin) --------
export const listAllCrmUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "super_admin") throw new Error("Sem permissão");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: creds } = await supabaseAdmin
      .from("credentials")
      .select("id_empresa")
      .eq("default_crm", "katsuki");
    const allowed = (creds ?? [])
      .map((c: any) => c.id_empresa as number | null)
      .filter((v: number | null): v is number => v != null);
    if (!allowed.length) return [];
    const { data, error } = await supabaseAdmin
      .from("crm_users")
      .select("id,nome,email,role,active,id_empresa,created_at")
      .in("id_empresa", allowed)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
