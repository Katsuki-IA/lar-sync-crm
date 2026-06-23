import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  generateTemporaryPassword,
  getPasswordPolicyError,
  PASSWORD_POLICY_MESSAGE,
} from "@/lib/password-policy";

export const hasAnyCrmUser = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("crm_users").select("id").limit(1);
  if (error) throw new Error(error.message);
  return { hasUsers: (data?.length ?? 0) > 0 };
});

export const firstSetup = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        nome: z.string().min(2),
        email: z.string().email(),
        password: z
          .string()
          .refine((password) => !getPasswordPolicyError(password), PASSWORD_POLICY_MESSAGE)
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verifica se já existe algum usuário no CRM
    const { data: existing, error: countErr } = await supabaseAdmin
      .from("crm_users")
      .select("id")
      .limit(1);
    if (countErr) throw new Error(countErr.message);
    if (existing && existing.length > 0) throw new Error("O sistema já foi configurado. Use a página de login.");

    const password = data.password ?? generateTemporaryPassword();

    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (authErr || !authData.user) throw new Error(authErr?.message ?? "Falha ao criar usuário");

    const { error: insErr } = await supabaseAdmin.from("crm_users").insert({
      auth_user_id: authData.user.id,
      nome: data.nome,
      email: data.email,
      role: "super_admin",
      active: true,
    });
    if (insErr) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw new Error(insErr.message);
    }

    return { ok: true, password };
  });
