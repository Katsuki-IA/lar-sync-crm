import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const hasAnyCrmUser = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("crm_users").select("id").limit(1);
  if (error) throw new Error(error.message);
  return { hasUsers: (data?.length ?? 0) > 0 };
});

function randomPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out + "!2";
}

export const firstSetup = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        nome: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(6).optional(),
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

    const password = data.password ?? randomPassword();

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
