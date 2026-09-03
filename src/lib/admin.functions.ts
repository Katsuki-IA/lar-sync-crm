import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  generateTemporaryPassword,
  getPasswordPolicyError,
  PASSWORD_POLICY_MESSAGE,
} from "@/lib/password-policy";

const CRM_DISPATCH_STAGE_NAMES = [
  "Follow Up 1",
  "Follow Up 2",
  "Follow Up 3",
  "Follow Up 4",
  "Visita Agendada",
] as const;

const CRM_DISPATCH_WITHOUT_CONTACT_STAGE_NAMES = [
  "Follow Up 1",
  "Follow Up 2",
  "Follow Up 3",
  "Follow Up 4",
] as const;

const CRM_DISPATCH_STAGE_NAME_SET = new Set<string>(CRM_DISPATCH_STAGE_NAMES);
const CRM_DISPATCH_WITHOUT_CONTACT_STAGE_NAME_SET = new Set<string>(
  CRM_DISPATCH_WITHOUT_CONTACT_STAGE_NAMES,
);

const AI_TECHNICAL_EMAIL_PATTERN = /^ia\+\d+@hub\.katsuki\.local$/i;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isAiTechnicalUser(user: {
  auth_user_id: string | null;
  email: string | null;
  role: string;
}) {
  return (
    !user.auth_user_id &&
    (user.role === "ai_agent" || user.role === "agent") &&
    typeof user.email === "string" &&
    AI_TECHNICAL_EMAIL_PATTERN.test(user.email)
  );
}

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

    const normalizedEmail = normalizeEmail(data.email);
    if (AI_TECHNICAL_EMAIL_PATTERN.test(normalizedEmail)) {
      throw new Error(
        "Este e-mail é reservado ao Atendente IA e é criado automaticamente pelo sistema",
      );
    }

    const password = data.password ?? generateTemporaryPassword();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (authErr || !authData.user) throw new Error(authErr?.message ?? "Falha ao criar usuário");

    const { error: insErr } = await supabaseAdmin.from("crm_users").insert({
      auth_user_id: authData.user.id,
      id_empresa: targetEmpresa,
      nome: data.nome,
      email: normalizedEmail,
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
    if (me.role === "manager" && target.id_empresa !== me.id_empresa)
      throw new Error("Sem permissão");
    if (!target.auth_user_id) throw new Error("Usuário sem auth vinculado");
    const password = generateTemporaryPassword();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(target.auth_user_id, {
      password,
    });
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
      .select("id_empresa,auth_user_id,email,role")
      .eq("id", data.user_id)
      .maybeSingle();
    if (!target) throw new Error("Usuário não encontrado");
    if (me.role === "manager" && target.id_empresa !== me.id_empresa)
      throw new Error("Sem permissão");
    if (isAiTechnicalUser(target)) {
      throw new Error("O Atendente IA é um usuário técnico e permanece inativo para login");
    }
    const { error } = await supabaseAdmin
      .from("crm_users")
      .update({ active: data.active })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Atualizar usuário CRM (super admin) --------
export const updateCrmUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        user_id: z.string().uuid(),
        nome: z.string().min(2),
        email: z.string().email(),
        role: z.enum(["agent", "manager", "super_admin"]),
        id_empresa: z.number().nullable().optional(),
        password: z
          .string()
          .refine((password) => !getPasswordPolicyError(password), PASSWORD_POLICY_MESSAGE)
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "super_admin") throw new Error("Sem permissão");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target, error: targetError } = await supabaseAdmin
      .from("crm_users")
      .select("id,auth_user_id,email,role,id_empresa")
      .eq("id", data.user_id)
      .maybeSingle();

    if (targetError || !target) throw new Error("Usuário não encontrado");

    const isAiUser = isAiTechnicalUser(target);

    if (isAiUser) {
      throw new Error("Use a edição específica para renomear o atendente IA");
    }

    if (data.role !== "super_admin" && !data.id_empresa) {
      throw new Error("Empresa obrigatória para gestor ou corretor");
    }

    const normalizedEmail = normalizeEmail(data.email);
    if (AI_TECHNICAL_EMAIL_PATTERN.test(normalizedEmail)) {
      throw new Error(
        "Este e-mail é reservado ao Atendente IA e é criado automaticamente pelo sistema",
      );
    }

    if (target.auth_user_id) {
      const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(
        target.auth_user_id,
        {
          email: normalizedEmail,
          ...(data.password ? { password: data.password } : {}),
          user_metadata: { nome: data.nome },
        },
      );
      if (authUpdateError) throw new Error(authUpdateError.message);
    }

    const { error: updateError } = await supabaseAdmin
      .from("crm_users")
      .update({
        nome: data.nome.trim(),
        email: normalizedEmail,
        role: data.role,
        id_empresa: data.role === "super_admin" ? null : (data.id_empresa ?? null),
      })
      .eq("id", data.user_id);

    if (updateError) throw new Error(updateError.message);
    return { ok: true };
  });

// -------- Renomear usuário técnico da IA (super admin) --------
export const renameAiCrmUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ user_id: z.string().uuid(), nome: z.string().min(2).max(120) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "super_admin") throw new Error("Sem permissão");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target, error: targetError } = await supabaseAdmin
      .from("crm_users")
      .select("id, id_empresa, auth_user_id, email, role")
      .eq("id", data.user_id)
      .maybeSingle();

    if (targetError || !target) throw new Error("Usuário não encontrado");

    const isAiUser = isAiTechnicalUser(target);

    if (!isAiUser) {
      throw new Error("Apenas o usuário técnico da IA pode ser renomeado aqui");
    }

    if (!target.id_empresa) throw new Error("Atendente IA sem empresa vinculada");

    const nome = data.nome.trim();
    const { error: companyError } = await supabaseAdmin
      .from("empresa_dados")
      .update({ nome_atendente_ia: nome })
      .eq("id", target.id_empresa);

    if (companyError) throw new Error(companyError.message);

    const { error } = await supabaseAdmin
      .from("crm_users")
      .update({ nome, role: "ai_agent", active: false })
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
      .eq("default_crm", "hub");
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

// -------- Empresas Hub com envio ao CRM configurável (super admin) --------
export const listCrmDispatchEmpresas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "super_admin") throw new Error("Sem permissão");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: credentials, error: credentialsError } = await supabaseAdmin
      .from("credentials")
      .select("id_empresa")
      .eq("default_crm", "hub");
    if (credentialsError) throw new Error(credentialsError.message);

    const companyIds = (credentials ?? [])
      .map((credential: any) => credential.id_empresa as number | null)
      .filter((id: number | null): id is number => id != null);
    if (!companyIds.length) return [];

    const { data, error } = await supabaseAdmin
      .from("empresa_dados")
      .select("id,nome,default_crm")
      .in("id", companyIds)
      .order("nome", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
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
      .eq("default_crm", "hub");
    const allowed = (creds ?? [])
      .map((c: any) => c.id_empresa as number | null)
      .filter((v: number | null): v is number => v != null);
    const { data, error } = await supabaseAdmin
      .from("crm_users")
      .select("id,nome,email,role,active,id_empresa,created_at,auth_user_id")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).filter((user: any) => {
      if (user.role === "super_admin") return true;
      if (user.id_empresa == null) return false;
      return allowed.includes(user.id_empresa);
    });
  });

// -------- Configuração de envio ao CRM por empresa (super admin) --------
export const getCrmDispatchSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id_empresa: z.number().int().positive() }).parse(d))
  .handler(async ({ data, context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "super_admin") throw new Error("Sem permissão");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const loadStages = async () => {
      const [
        { data: globalStages, error: globalStagesError },
        { data: localStages, error: localStagesError },
      ] = await Promise.all([
        supabaseAdmin
          .from("crm_global_stages")
          .select("id,nome,ordem")
          .eq("ativo", true)
          .order("ordem", { ascending: true }),
        supabaseAdmin
          .from("crm_stages")
          .select("id,nome,ordem,global_stage_id")
          .eq("id_empresa", data.id_empresa)
          .eq("ativo", true),
      ]);

      if (globalStagesError) throw new Error(globalStagesError.message);
      if (localStagesError) throw new Error(localStagesError.message);

      const localByGlobalId = new Map<number, number>();
      const localByName = new Map<string, { id: number; ordem: number }>();
      for (const stage of localStages ?? []) {
        if (stage.global_stage_id != null) {
          localByGlobalId.set(stage.global_stage_id as number, stage.id as number);
        }
        if (typeof stage.nome === "string") {
          localByName.set(stage.nome.trim().toLowerCase(), {
            id: stage.id as number,
            ordem: stage.ordem as number,
          });
        }
      }

      const stages = (globalStages ?? [])
        .filter((stage: any) => CRM_DISPATCH_STAGE_NAME_SET.has(stage.nome))
        .map((stage: any) => {
          const fallbackLocal = localByName.get(String(stage.nome).trim().toLowerCase());
          return {
            id: localByGlobalId.get(stage.id as number) ?? fallbackLocal?.id,
            nome: stage.nome as string,
            ordem: fallbackLocal?.ordem ?? (stage.ordem as number),
            global_stage_id: stage.id as number,
          };
        })
        .filter((stage) => stage.id != null);

      if (stages.length > 0) {
        return stages as Array<{
          id: number;
          nome: string;
          ordem: number;
          global_stage_id: number;
        }>;
      }

      return (localStages ?? [])
        .filter((stage: any) => CRM_DISPATCH_STAGE_NAME_SET.has(String(stage.nome ?? "").trim()))
        .map((stage: any) => ({
          id: stage.id as number,
          nome: stage.nome as string,
          ordem: stage.ordem as number,
          global_stage_id: stage.global_stage_id as number | null,
        }))
        .sort((a, b) => a.ordem - b.ordem);
    };

    let stages = await loadStages();
    if (stages.length === 0) {
      const { error: syncError } = await supabaseAdmin.rpc("crm_sync_company_global_config", {
        p_id_empresa: data.id_empresa,
      });
      if (syncError) throw new Error(syncError.message);
      stages = await loadStages();
    }

    const [settingsResult, empreendimentosResult, overridesResult, companyResult, credentialsResult] = await Promise.all([
      supabaseAdmin
        .from("crm_lead_dispatch_settings")
        .select(
          "stage_without_contact_id,stage_with_contact_id,dispatch_delay_minutes,external_stage_blocked_send_id,external_stage_qualified_id,external_stage_unqualified_id,external_stage_visit_scheduled_id,external_stage_lost_id,external_stage_without_whatsapp_id,updated_at",
        )
        .eq("id_empresa", data.id_empresa)
        .maybeSingle(),
      supabaseAdmin
        .from("empreendimento")
        .select("id,nome")
        .eq("id_empresa", data.id_empresa)
        .order("nome", { ascending: true }),
      supabaseAdmin
        .from("crm_lead_dispatch_stage_overrides")
        .select(
          "id_empreendimento,external_stage_blocked_send_id,external_stage_qualified_id,external_stage_unqualified_id,external_stage_visit_scheduled_id,external_stage_lost_id,external_stage_without_whatsapp_id",
        )
        .eq("id_empresa", data.id_empresa),
      supabaseAdmin
        .from("empresa_dados")
        .select("default_crm")
        .eq("id", data.id_empresa)
        .maybeSingle(),
      supabaseAdmin
        .from("credentials")
        .select("cv_crm_url,cv_crm_token")
        .eq("id_empresa", data.id_empresa)
        .maybeSingle(),
    ]);

    if (settingsResult.error) throw new Error(settingsResult.error.message);
    if (empreendimentosResult.error) throw new Error(empreendimentosResult.error.message);
    if (overridesResult.error) throw new Error(overridesResult.error.message);
    if (companyResult.error) throw new Error(companyResult.error.message);
    if (credentialsResult.error) throw new Error(credentialsResult.error.message);

    const settings = settingsResult.data;

    return {
      stages: stages.map((stage) => ({ id: stage.id, nome: stage.nome, ordem: stage.ordem })),
      settings: {
        stage_without_contact_id: settings?.stage_without_contact_id ?? null,
        stage_with_contact_id: settings?.stage_with_contact_id ?? null,
        dispatch_delay_minutes: settings?.dispatch_delay_minutes ?? 60,
        external_stage_blocked_send_id: settings?.external_stage_blocked_send_id ?? null,
        external_stage_qualified_id: settings?.external_stage_qualified_id ?? null,
        external_stage_unqualified_id: settings?.external_stage_unqualified_id ?? null,
        external_stage_visit_scheduled_id: settings?.external_stage_visit_scheduled_id ?? null,
        external_stage_lost_id: settings?.external_stage_lost_id ?? null,
        external_stage_without_whatsapp_id: settings?.external_stage_without_whatsapp_id ?? null,
        updated_at: settings?.updated_at ?? null,
      },
      empreendimentos: empreendimentosResult.data ?? [],
      stage_overrides: overridesResult.data ?? [],
      external_crm: {
        provider: companyResult.data?.default_crm ?? null,
        katsuki_api_key_configured: Boolean(credentialsResult.data?.cv_crm_token),
        active: Boolean(credentialsResult.data?.cv_crm_url && credentialsResult.data?.cv_crm_token),
      },
    };
  });

export const saveCrmDispatchSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id_empresa: z.number().int().positive(),
        stage_without_contact_id: z.number().int().positive().nullable(),
        stage_with_contact_id: z.number().int().positive().nullable(),
        dispatch_delay_minutes: z.number().int().min(0).max(10080),
        external_stage_blocked_send_id: z.string().trim().max(120).nullable(),
        external_stage_qualified_id: z.string().trim().max(120).nullable(),
        external_stage_unqualified_id: z.string().trim().max(120).nullable(),
        external_stage_visit_scheduled_id: z.string().trim().max(120).nullable(),
        external_stage_lost_id: z.string().trim().max(120).nullable(),
        external_stage_without_whatsapp_id: z.string().trim().max(120).nullable(),
        stage_overrides: z
          .array(
            z.object({
              id_empreendimento: z.number().int().positive(),
              external_stage_blocked_send_id: z.string().trim().max(120).nullable(),
              external_stage_qualified_id: z.string().trim().max(120).nullable(),
              external_stage_unqualified_id: z.string().trim().max(120).nullable(),
              external_stage_visit_scheduled_id: z.string().trim().max(120).nullable(),
              external_stage_lost_id: z.string().trim().max(120).nullable(),
              external_stage_without_whatsapp_id: z.string().trim().max(120).nullable(),
            }),
          )
          .default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const me = await getMe(context.supabase, context.userId);
    if (me.role !== "super_admin") throw new Error("Sem permissão");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: syncError } = await supabaseAdmin.rpc("crm_sync_company_global_config", {
      p_id_empresa: data.id_empresa,
    });
    if (syncError) throw new Error(syncError.message);

    const [
      { data: allowedGlobalStages, error: allowedGlobalStagesError },
      { data: allowedLocalStages, error: allowedLocalStagesError },
    ] = await Promise.all([
      supabaseAdmin.from("crm_global_stages").select("id,nome").eq("ativo", true),
      supabaseAdmin
        .from("crm_stages")
        .select("id,nome,global_stage_id")
        .eq("id_empresa", data.id_empresa)
        .eq("ativo", true),
    ]);

    if (allowedGlobalStagesError) throw new Error(allowedGlobalStagesError.message);
    if (allowedLocalStagesError) throw new Error(allowedLocalStagesError.message);

    const globalNameById = new Map<number, string>();
    for (const stage of allowedGlobalStages ?? []) {
      globalNameById.set(stage.id as number, stage.nome as string);
    }

    const allowedIds = new Set<number>();
    const withoutContactAllowedIds = new Set<number>();

    for (const stage of allowedLocalStages ?? []) {
      const globalStageId = stage.global_stage_id as number | null;
      const globalName = globalStageId != null ? globalNameById.get(globalStageId) : null;
      const localName = typeof stage.nome === "string" ? stage.nome.trim() : "";
      const stageName = globalName ?? localName;
      if (!stageName || !CRM_DISPATCH_STAGE_NAME_SET.has(stageName)) continue;
      allowedIds.add(stage.id as number);
      if (CRM_DISPATCH_WITHOUT_CONTACT_STAGE_NAME_SET.has(stageName)) {
        withoutContactAllowedIds.add(stage.id as number);
      }
    }

    if (
      data.stage_without_contact_id != null &&
      !withoutContactAllowedIds.has(data.stage_without_contact_id)
    ) {
      throw new Error("A etapa selecionada para lead sem contato não pertence a esta empresa");
    }
    if (data.stage_with_contact_id != null && !allowedIds.has(data.stage_with_contact_id)) {
      throw new Error("A etapa selecionada para lead com contato não pertence a esta empresa");
    }

    const { data: companyProjects, error: companyProjectsError } = await supabaseAdmin
      .from("empreendimento")
      .select("id")
      .eq("id_empresa", data.id_empresa);
    if (companyProjectsError) throw new Error(companyProjectsError.message);

    const companyProjectIds = new Set(
      (companyProjects ?? []).map((project: any) => project.id as number),
    );
    if (
      data.stage_overrides.some((override) => !companyProjectIds.has(override.id_empreendimento))
    ) {
      throw new Error("Um dos empreendimentos selecionados não pertence a esta empresa");
    }

    const { error } = await supabaseAdmin.from("crm_lead_dispatch_settings").upsert(
      {
        id_empresa: data.id_empresa,
        stage_without_contact_id: data.stage_without_contact_id,
        stage_with_contact_id: data.stage_with_contact_id,
        dispatch_delay_minutes: data.dispatch_delay_minutes,
        external_stage_blocked_send_id: data.external_stage_blocked_send_id,
        external_stage_qualified_id: data.external_stage_qualified_id,
        external_stage_unqualified_id: data.external_stage_unqualified_id,
        external_stage_visit_scheduled_id: data.external_stage_visit_scheduled_id,
        external_stage_lost_id: data.external_stage_lost_id,
        external_stage_without_whatsapp_id: data.external_stage_without_whatsapp_id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id_empresa" },
    );

    if (error) throw new Error(error.message);

    const overridesWithValues = data.stage_overrides.filter((override) =>
      [
        override.external_stage_blocked_send_id,
        override.external_stage_qualified_id,
        override.external_stage_unqualified_id,
        override.external_stage_visit_scheduled_id,
        override.external_stage_lost_id,
        override.external_stage_without_whatsapp_id,
      ].some(Boolean),
    );
    const overridesToClear = data.stage_overrides
      .filter((override) => !overridesWithValues.includes(override))
      .map((override) => override.id_empreendimento);

    if (overridesWithValues.length) {
      const { error: overridesError } = await supabaseAdmin
        .from("crm_lead_dispatch_stage_overrides")
        .upsert(
          overridesWithValues.map((override) => ({
            id_empresa: data.id_empresa,
            ...override,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "id_empresa,id_empreendimento" },
        );
      if (overridesError) throw new Error(overridesError.message);
    }

    if (overridesToClear.length) {
      const { error: clearOverridesError } = await supabaseAdmin
        .from("crm_lead_dispatch_stage_overrides")
        .delete()
        .eq("id_empresa", data.id_empresa)
        .in("id_empreendimento", overridesToClear);
      if (clearOverridesError) throw new Error(clearOverridesError.message);
    }

    return { ok: true };
  });

function normalizeSiteLeadDomains(domains: string[]) {
  return Array.from(
    new Set(
      domains
        .map((domain) =>
          domain
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/\/.*$/, "")
            .replace(/^www\./, ""),
        )
        .filter(Boolean),
    ),
  );
}

function createSiteLeadToken() {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

async function listHubCompanyIds(supabaseAdmin: any) {
  const { data: creds, error } = await supabaseAdmin
    .from("credentials")
    .select("id_empresa")
    .eq("default_crm", "hub");
  if (error) throw new Error(error.message);
  return (creds ?? [])
    .map((credential: any) => credential.id_empresa as number | null)
    .filter((value: number | null): value is number => value != null);
}

async function assertSuperAdmin(context: { supabase: any; userId: string }) {
  const me = await getMe(context.supabase, context.userId);
  if (me.role !== "super_admin") throw new Error("Sem permissão");
}

async function assertSiteSourceCompany(
  supabaseAdmin: any,
  sourceId: string,
  allowedCompanyIds: number[],
) {
  const { data, error } = await (supabaseAdmin as any)
    .from("crm_site_lead_sources")
    .select("id,id_empresa")
    .eq("id", sourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Fonte não encontrada");
  if (!allowedCompanyIds.includes(data.id_empresa)) throw new Error("Empresa sem CRM Hub");
  return data as { id: string; id_empresa: number };
}

async function assertEmpreendimentoBelongsToCompany(
  supabaseAdmin: any,
  idEmpresa: number,
  idEmpreendimento: number,
) {
  const { data, error } = await supabaseAdmin
    .from("empreendimento")
    .select("id")
    .eq("id", idEmpreendimento)
    .eq("id_empresa", idEmpresa)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Empreendimento inválido para a empresa");
}

export const listSiteLeadSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const allowedCompanyIds = await listHubCompanyIds(supabaseAdmin);
    if (!allowedCompanyIds.length) {
      return { empresas: [], empreendimentos: [], sources: [] };
    }

    const [
      { data: empresas, error: empresasError },
      { data: empreendimentos, error: empError },
      { data: sources, error: sourcesError },
    ] = await Promise.all([
      supabaseAdmin
        .from("empresa_dados")
        .select("id,nome")
        .in("id", allowedCompanyIds)
        .order("nome", { ascending: true }),
      supabaseAdmin
        .from("empreendimento")
        .select("id,id_empresa,nome")
        .in("id_empresa", allowedCompanyIds)
        .order("nome", { ascending: true }),
      admin
        .from("crm_site_lead_sources")
        .select(
          "id,id_empresa,id_empreendimento,nome,token,allowed_domains,origem,active,leads_count,last_lead_at,last_error,created_at,updated_at",
        )
        .in("id_empresa", allowedCompanyIds)
        .order("created_at", { ascending: false }),
    ]);

    if (empresasError) throw new Error(empresasError.message);
    if (empError) throw new Error(empError.message);
    if (sourcesError) throw new Error(sourcesError.message);

    return {
      empresas: empresas ?? [],
      empreendimentos: empreendimentos ?? [],
      sources: sources ?? [],
    };
  });

export const createSiteLeadSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id_empresa: z.number().int().positive(),
        id_empreendimento: z.number().int().positive(),
        nome: z.string().min(2).max(160),
        allowed_domains: z.array(z.string()).default([]),
        origem: z.string().min(2).max(8).default("SI"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const allowedCompanyIds = await listHubCompanyIds(supabaseAdmin);
    if (!allowedCompanyIds.includes(data.id_empresa)) throw new Error("Empresa sem CRM Hub");
    await assertEmpreendimentoBelongsToCompany(
      supabaseAdmin,
      data.id_empresa,
      data.id_empreendimento,
    );

    const { error } = await (supabaseAdmin as any).from("crm_site_lead_sources").insert({
      id_empresa: data.id_empresa,
      id_empreendimento: data.id_empreendimento,
      nome: data.nome.trim(),
      token: createSiteLeadToken(),
      allowed_domains: normalizeSiteLeadDomains(data.allowed_domains),
      origem: data.origem.trim().toUpperCase() || "SI",
      active: true,
    });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateSiteLeadSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        nome: z.string().min(2).max(160),
        allowed_domains: z.array(z.string()).default([]),
        origem: z.string().min(2).max(8).default("SI"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const allowedCompanyIds = await listHubCompanyIds(supabaseAdmin);
    await assertSiteSourceCompany(supabaseAdmin, data.id, allowedCompanyIds);

    const { error } = await (supabaseAdmin as any)
      .from("crm_site_lead_sources")
      .update({
        nome: data.nome.trim(),
        allowed_domains: normalizeSiteLeadDomains(data.allowed_domains),
        origem: data.origem.trim().toUpperCase() || "SI",
      })
      .eq("id", data.id);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setSiteLeadSourceActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const allowedCompanyIds = await listHubCompanyIds(supabaseAdmin);
    await assertSiteSourceCompany(supabaseAdmin, data.id, allowedCompanyIds);

    const { error } = await (supabaseAdmin as any)
      .from("crm_site_lead_sources")
      .update({ active: data.active })
      .eq("id", data.id);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rotateSiteLeadSourceToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const allowedCompanyIds = await listHubCompanyIds(supabaseAdmin);
    await assertSiteSourceCompany(supabaseAdmin, data.id, allowedCompanyIds);

    const token = createSiteLeadToken();
    const { error } = await (supabaseAdmin as any)
      .from("crm_site_lead_sources")
      .update({ token })
      .eq("id", data.id);

    if (error) throw new Error(error.message);
    return { ok: true, token };
  });
