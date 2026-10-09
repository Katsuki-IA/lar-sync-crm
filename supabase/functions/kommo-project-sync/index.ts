import { createSupabaseAdmin } from "../_shared/meta.ts";
import {
  companyContext,
  loadConfig,
  withCompanyLock,
  provision,
  saveConfig,
  leadProject,
  projectFieldValue,
  mayUpdateRemote,
  positiveId,
} from "../_shared/kommo-projects.ts";

Deno.serve(async (req) => {
  const secret = Deno.env.get("META_HEALTH_CRON_SECRET");
  if (!secret || req.headers.get("x-meta-health-secret") !== secret)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const db = createSupabaseAdmin();
  const startedAt = Date.now();
  const now = new Date().toISOString();
  const due = await db
    .from("crm_kommo_project_settings")
    .select("id_empresa")
    .eq("enabled", true)
    .lte("next_run_at", now)
    .order("next_run_at")
    .limit(1);
  if (due.error) return Response.json({ error: "Falha ao consultar empresas" }, { status: 500 });
  let checked = 0;
  for (const company of due.data ?? []) {
    try {
      await withCompanyLock(db, company.id_empresa, async () => {
        let config = await loadConfig(db, company.id_empresa);
        if (!config?.enabled) return;
        const { api, projects } = await companyContext(db, company.id_empresa);
        // Also validates account identity and existing field. Missing options are never silently omitted.
        config = await provision(api, config, projects);
        await saveConfig(db, config);
        const seed = await db.rpc("kommo_project_seed_sync", { p_company: company.id_empresa });
        if (seed.error) throw new Error("Falha ao localizar os leads enviados ao Kommo.");
        const jobs = await db
          .from("crm_kommo_project_sync")
          .select("*")
          .eq("id_empresa", company.id_empresa)
          .lte("next_check_at", now)
          .neq("status", "conflict")
          .order("next_check_at")
          .limit(5);
        if (jobs.error) throw new Error("Falha ao consultar os leads pendentes.");
        for (const job of jobs.data ?? []) {
          if (Date.now() - startedAt > 30000) break;
          try {
            if (job.account_url !== api.base || job.field_id !== config.field_id)
              throw new Error("O vínculo pertence a outra configuração Kommo.");
            if (!config.sync_interest && job.tracked) continue;
            const sharedIdentity = await db
              .from("crm_kommo_project_sync")
              .select("lead_id")
              .eq("id_empresa", company.id_empresa)
              .eq("external_id", job.external_id)
              .neq("lead_id", job.lead_id)
              .limit(1);
            if (sharedIdentity.error || sharedIdentity.data?.length)
              throw new Error(
                "O mesmo lead Kommo está vinculado a mais de um cadastro do Hub. Revise o vínculo.",
              );
            const lead = await db
              .from("crm_leads")
              .select("id,id_empreendimento")
              .eq("id_empresa", company.id_empresa)
              .eq("id", job.lead_id)
              .single();
            if (lead.error) throw new Error("Lead não encontrado na empresa.");
            const project = await leadProject(db, company.id_empresa, lead.data, projects);
            const desired = projectFieldValue(config, project)!;
            const remote = await api.request(`/api/v4/leads/${job.external_id}`);
            const remoteField = remote.custom_fields_values?.find(
              (f: { field_id: number }) => f.field_id === config!.field_id,
            );
            const remoteValue = positiveId(remoteField?.values?.[0]?.enum_id);
            if (remoteField?.values?.length && !remoteValue)
              throw new Error("O campo do Kommo retornou um valor não reconhecido.");
            const decision = mayUpdateRemote(
              remoteValue,
              desired.values[0].enum_id,
              job.last_enum_id,
              job.tracked,
            );
            if (decision === "conflict") {
              const saved = await db
                .from("crm_kommo_project_sync")
                .update({
                  status: "conflict",
                  last_error: "Valor alterado no Kommo. Mantido para revisão manual.",
                  updated_at: now,
                })
                .eq("id_empresa", company.id_empresa)
                .eq("lead_id", job.lead_id);
              if (saved.error) throw new Error("Falha ao registrar divergência.");
            } else {
              if (decision === "update")
                await api.request(`/api/v4/leads/${job.external_id}`, "PATCH", {
                  custom_fields_values: [desired],
                });
              const saved = await db
                .from("crm_kommo_project_sync")
                .update({
                  status: "synced",
                  tracked: true,
                  last_enum_id: desired.values[0].enum_id,
                  last_error: project === null ? "Empreendimento ainda não definido no Hub." : null,
                  updated_at: now,
                })
                .eq("id_empresa", company.id_empresa)
                .eq("lead_id", job.lead_id);
              if (saved.error) throw new Error("Falha ao registrar sincronização.");
            }
            checked++;
          } catch (error) {
            await db
              .from("crm_kommo_project_sync")
              .update({
                status: "failed",
                last_error: error instanceof Error ? error.message : "Falha na sincronização",
                updated_at: now,
              })
              .eq("id_empresa", company.id_empresa)
              .eq("lead_id", job.lead_id);
          } finally {
            await db
              .from("crm_kommo_project_sync")
              .update({ next_check_at: new Date(Date.now() + 300000).toISOString() })
              .eq("id_empresa", company.id_empresa)
              .eq("lead_id", job.lead_id);
          }
        }
      });
    } catch (error) {
      await db
        .from("crm_kommo_project_settings")
        .update({ last_error: error instanceof Error ? error.message : "Falha ao sincronizar" })
        .eq("id_empresa", company.id_empresa);
    } finally {
      await db
        .from("crm_kommo_project_settings")
        .update({ next_run_at: new Date(Date.now() + 300000).toISOString() })
        .eq("id_empresa", company.id_empresa);
    }
  }
  return Response.json({ checked, companies: due.data?.length ?? 0 });
});
