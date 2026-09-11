import { createSupabaseAdmin, fetchGraphCollection, isMetaRateLimitError } from "./meta.ts";
import {
  createMetaFieldValueMap,
  getMappedMetaValue,
  normalizeBrazilPhone,
  type MetaLeadFieldData,
} from "./meta-lead.ts";
import { resolveLeadOrigin } from "./lead-origin.ts";
import { enrichMetaAttributionForCompany } from "./meta-attribution.ts";

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;

type MetaLead = {
  id: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  field_data?: MetaLeadFieldData[];
};

export type MetaConfiguredForm = {
  form_id: string;
  page_id: string;
  page_access_token: string | null;
  id_empreendimento: number | null;
  id_funnel: number | null;
};

export type MetaRecoveryResult = {
  checked: number;
  recovered: number;
  duplicates: number;
  failed: Array<{ formId: string; message: string }>;
  warnings: Array<{ formId: string; leadId?: string; message: string }>;
  attemptedUserTokenFallback: boolean;
  usedUserTokenFallback: boolean;
  rateLimited: boolean;
};

function pageReachedRecoveryBoundary(leads: MetaLead[], since: Date) {
  if (leads.length === 0) return true;
  const timestamps = leads.map((lead) => new Date(lead.created_time ?? "").getTime());
  if (timestamps.some((timestamp) => Number.isNaN(timestamp))) return false;
  const isDescending = timestamps.every(
    (timestamp, index) => index === 0 || timestamp <= timestamps[index - 1],
  );
  return isDescending && timestamps[timestamps.length - 1] < since.getTime();
}

function describeMetaAccessError(form: MetaConfiguredForm, error: unknown) {
  const message = error instanceof Error ? error.message : "Falha ao consultar formulario";
  const normalizedMessage = message.toLowerCase();
  const isFormAccessError =
    normalizedMessage.includes("unsupported get request") ||
    normalizedMessage.includes("does not exist, cannot be loaded due to missing permissions") ||
    normalizedMessage.includes("page token impersonation permissions") ||
    normalizedMessage.includes("permission(s) must be granted");

  if (!isFormAccessError) return message;

  return [
    `A Meta recusou o acesso ao formulario ${form.form_id} da Pagina ${form.page_id}.`,
    "No Gerenciador de Negocios da Meta, conceda Acesso a Leads dessa Pagina ao usuario que autorizou e ao aplicativo do Hub; depois reconecte a integracao.",
    `Detalhe da Meta: ${message}`,
  ].join(" ");
}

async function getRouting(supabaseAdmin: SupabaseAdmin, idEmpresa: number, funnelId: number) {
  const [{ data: manager, error: managerError }, { data: stage, error: stageError }] =
    await Promise.all([
      supabaseAdmin
        .from("crm_users")
        .select("id")
        .eq("id_empresa", idEmpresa)
        .eq("role", "manager")
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("crm_stages")
        .select("id")
        .eq("id_empresa", idEmpresa)
        .eq("id_funnel", funnelId)
        .eq("ativo", true)
        .order("ordem", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
  if (managerError) throw new Error(managerError.message);
  if (stageError) throw new Error(stageError.message);
  return { assignedTo: manager?.id ?? null, stageId: stage?.id ?? null };
}

export async function recoverMetaLeadsForForm(args: {
  supabaseAdmin: SupabaseAdmin;
  idEmpresa: number;
  connectionId: string;
  userAccessToken: string;
  graphVersion: string;
  form: MetaConfiguredForm;
  since: Date;
  until: Date;
  limit: number;
}): Promise<MetaRecoveryResult> {
  const result: MetaRecoveryResult = {
    checked: 0,
    recovered: 0,
    duplicates: 0,
    failed: [],
    warnings: [],
    attemptedUserTokenFallback: false,
    usedUserTokenFallback: false,
    rateLimited: false,
  };
  const { form } = args;
  if (!form.id_empreendimento || !form.id_funnel) {
    result.failed.push({ formId: form.form_id, message: "Formulario sem empreendimento ou funil" });
    return result;
  }

  try {
    const accessTokens = Array.from(
      new Set([form.page_access_token, args.userAccessToken].filter(Boolean) as string[]),
    );
    let leadsFromMeta: MetaLead[] | null = null;
    let lastAccessError: unknown = null;
    for (const [index, accessToken] of accessTokens.entries()) {
      if (index > 0) result.attemptedUserTokenFallback = true;
      const url = new URL(`https://graph.facebook.com/${args.graphVersion}/${form.form_id}/leads`);
      url.searchParams.set("fields", "id,created_time,ad_id,form_id,field_data");
      url.searchParams.set("limit", "100");
      url.searchParams.set("access_token", accessToken);
      try {
        leadsFromMeta = await fetchGraphCollection<MetaLead>(url, {
          maxItems: args.limit,
          stopAfterPage: (pageItems) => pageReachedRecoveryBoundary(pageItems, args.since),
        });
        result.usedUserTokenFallback = index > 0;
        break;
      } catch (error) {
        lastAccessError = error;
        if (isMetaRateLimitError(error)) {
          result.rateLimited = true;
          break;
        }
      }
    }
    if (!leadsFromMeta) throw lastAccessError ?? new Error("Falha ao acessar leads na Meta");

    const leads = leadsFromMeta
      .filter((lead) => {
        const createdAt = new Date(lead.created_time ?? "");
        return (
          !Number.isNaN(createdAt.getTime()) && createdAt >= args.since && createdAt <= args.until
        );
      })
      .slice(0, args.limit);

    const { data: mappings, error: mappingError } = await args.supabaseAdmin
      .from("crm_meta_field_mapping")
      .select("meta_field_key,crm_field")
      .eq("id_empresa", args.idEmpresa)
      .eq("form_id", form.form_id);
    if (mappingError) throw new Error(mappingError.message);
    const mapping = Object.fromEntries(
      (mappings ?? []).map((item) => [item.meta_field_key, item.crm_field]),
    );
    const routing = await getRouting(args.supabaseAdmin, args.idEmpresa, Number(form.id_funnel));

    for (const lead of leads) {
      result.checked += 1;
      try {
        const values = createMetaFieldValueMap(lead.field_data ?? []);
        const nome = getMappedMetaValue({ values, mapping, crmField: "nome" }).trim();
        const phone = normalizeBrazilPhone(
          getMappedMetaValue({ values, mapping, crmField: "telefone" }).trim(),
        );
        if (!nome || !phone.normalized) {
          throw new Error("Lead sem nome ou telefone conforme o mapeamento atual");
        }
        const email = getMappedMetaValue({ values, mapping, crmField: "email" }).trim() || null;
        const origem = resolveLeadOrigin(
          getMappedMetaValue({ values, mapping, crmField: "origem" }),
          "FB",
        );
        const observacoes =
          getMappedMetaValue({ values, mapping, crmField: "observacoes" }).trim() || null;
        const { data: ingestion, error: ingestionError } = await args.supabaseAdmin.rpc(
          "crm_ingest_meta_lead",
          {
            p_id_empresa: args.idEmpresa,
            p_form_id: form.form_id,
            p_lead_id_meta: lead.id,
            p_nome: nome,
            p_email: email,
            p_telefone: phone.normalized,
            p_raw_data: {
              source: "meta_recovery",
              lead,
              recovered_at: new Date().toISOString(),
              destination: {
                id_empresa: args.idEmpresa,
                id_empreendimento: form.id_empreendimento,
                id_funnel: form.id_funnel,
              },
            },
            p_origem: origem,
            p_observacoes: observacoes,
            p_id_empreendimento: form.id_empreendimento,
            p_crm_stage_id: routing.stageId,
            p_crm_assigned_to: routing.assignedTo,
          },
        );
        if (ingestionError) throw new Error(ingestionError.message);
        const ingestionResult = Array.isArray(ingestion) ? ingestion[0] : ingestion;
        if (ingestionResult?.was_inserted) result.recovered += 1;
        else result.duplicates += 1;

        if (lead.ad_id && ingestionResult?.created_lead_id) {
          const enrichment = await enrichMetaAttributionForCompany({
            supabaseAdmin: args.supabaseAdmin,
            idEmpresa: args.idEmpresa,
            accessToken: args.userAccessToken,
            graphVersion: args.graphVersion,
            leadId: ingestionResult.created_lead_id,
            metaLeadgenId: lead.id,
            limit: 1,
          });
          for (const failure of enrichment.failed) {
            result.warnings.push({
              formId: form.form_id,
              leadId: lead.id,
              message: failure.message,
            });
          }
        }
      } catch (error) {
        result.warnings.push({
          formId: form.form_id,
          leadId: lead.id,
          message: error instanceof Error ? error.message : "Falha ao recuperar lead",
        });
      }
    }

    const { error: recoveryUpdateError } = await args.supabaseAdmin
      .from("crm_meta_forms")
      .update({ last_recovered_at: new Date().toISOString() })
      .eq("id_empresa", args.idEmpresa)
      .eq("connection_id", args.connectionId)
      .eq("form_id", form.form_id);
    if (recoveryUpdateError) throw new Error(recoveryUpdateError.message);
  } catch (error) {
    result.failed.push({
      formId: form.form_id,
      message: describeMetaAccessError(form, error),
    });
  }

  return result;
}
