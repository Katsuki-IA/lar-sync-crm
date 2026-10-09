import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import {
  companyContext,
  loadConfig,
  positiveId,
  provision,
  saveConfig,
  withCompanyLock,
  STANDARD_FIELD,
  type ProjectConfig,
} from "../_shared/kommo-projects.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido" }, 405);
  return withErrorHandling(async () => {
    const { crmUser } = await getAuthorizedCrmUser(req);
    const input = await req.json();
    const companyId = positiveId(input.companyId);
    if (!companyId || (crmUser.role !== "super_admin" && crmUser.id_empresa !== companyId))
      return jsonResponse({ error: "Sem permissão para esta empresa" }, 403);
    const db = createSupabaseAdmin();
    const { api, projects } = await companyContext(db, companyId);
    const action = input.action ?? "status";
    if (action === "status") {
      const config = await loadConfig(db, companyId);
      const sync = await db
        .from("crm_kommo_project_sync")
        .select("lead_id,status,last_error,updated_at")
        .eq("id_empresa", companyId)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (sync.error) throw new Error("Falha ao consultar sincronização Kommo.");
      return jsonResponse({
        config: config
          ? {
              enabled: config.enabled,
              field_id: config.field_id,
              field_name: config.field_name,
              mappings: config.mappings,
              unknown_policy: config.unknown_policy,
              unknown_enum_id: config.unknown_enum_id,
              auto_create_options: config.auto_create_options,
              sync_interest: config.sync_interest,
              last_error: (config as ProjectConfig & { last_error: string }).last_error,
              account_matches: config.account_url === api.base,
            }
          : null,
        projects,
        sync: sync.data,
      });
    }
    if (action === "fields")
      return jsonResponse({
        fields: (await api.fields())
          .filter((f) => f.type === "select")
          .map((f) => ({ id: f.id, name: f.name, enums: f.enums })),
      });
    if (!["configure", "disable", "sync"].includes(action)) throw new Error("Ação inválida.");
    const current = await loadConfig(db, companyId);
    if (!current) {
      if (action !== "configure")
        throw new Error("Configure a identificação de empreendimento primeiro.");
      const inserted = await db
        .from("crm_kommo_project_settings")
        .upsert(
          { id_empresa: companyId, account_url: api.base },
          { onConflict: "id_empresa", ignoreDuplicates: true },
        );
      if (inserted.error) throw new Error("Falha ao iniciar configuração.");
    }
    return withCompanyLock(db, companyId, async () => {
      const existing = (await loadConfig(db, companyId))!;
      if (action === "disable") {
        await saveConfig(db, { ...existing, enabled: false });
        return jsonResponse({ ok: true });
      }
      let desired = existing;
      if (existing.field_id && existing.account_url !== api.base)
        throw new Error(
          "A conta Kommo mudou. É necessário revisar os vínculos dos leads antes de configurar a nova conta.",
        );
      if (action === "configure") {
        if (
          !["undefined", "block"].includes(input.unknownPolicy) ||
          typeof input.autoCreateOptions !== "boolean" ||
          typeof input.syncInterest !== "boolean"
        )
          throw new Error("Configurações inválidas.");
        const fieldId = input.createStandard === true ? null : positiveId(input.fieldId);
        if (!fieldId && input.createStandard !== true)
          throw new Error("Escolha um campo do Kommo.");
        const mappings: Record<string, number> = {};
        if (!input.mappings || typeof input.mappings !== "object" || Array.isArray(input.mappings))
          throw new Error("Mapeamento inválido.");
        for (const [key, value] of Object.entries(input.mappings)) {
          if (!projects.some((p) => String(p.id) === key) || !positiveId(value))
            throw new Error("Empreendimento ou opção inválida no mapeamento.");
          mappings[key] = positiveId(value)!;
        }
        desired = {
          ...existing,
          enabled: true,
          account_url: api.base,
          account_id: existing.account_url === api.base ? existing.account_id : null,
          field_id: fieldId,
          field_name: STANDARD_FIELD,
          mappings,
          unknown_policy: input.unknownPolicy,
          unknown_enum_id: fieldId === existing.field_id ? existing.unknown_enum_id : null,
          auto_create_options: input.autoCreateOptions,
          sync_interest: input.syncInterest,
        };
      }
      const updated = await provision(api, desired, projects, input.createStandard === true);
      await saveConfig(db, updated);
      // A new field/account needs a fresh remote check, never assumptions based on the old field.
      if (existing.field_id !== updated.field_id || existing.account_url !== updated.account_url) {
        const cleared = await db
          .from("crm_kommo_project_sync")
          .delete()
          .eq("id_empresa", companyId);
        if (cleared.error)
          throw new Error(
            "Configuração salva; não foi possível reiniciar a conferência dos leads.",
          );
      }
      const scheduled = await db
        .from("crm_kommo_project_settings")
        .update({ next_run_at: new Date().toISOString() })
        .eq("id_empresa", companyId);
      if (scheduled.error) throw new Error("Configuração salva; falha ao agendar a sincronização.");
      return jsonResponse({
        ok: true,
        field: { id: updated.field_id, name: updated.field_name },
        mapped: Object.keys(updated.mappings).length,
      });
    });
  });
});
