import { z } from "zod";
import { reportingDb } from "./reporting-db.server";
import {
  chooseAttribution,
  cvIdFromResponse,
  reportPeriod,
  reportPersonKey,
  reportingQuerySchema,
  sha256Hex,
} from "./reporting-utils";
import { getLeadOriginLabel } from "./lead-origin";

const nullableText = z.string().nullable();
const attributionSchema = z.object({
  source_type: z.string(),
  created_at: z.string(),
  meta_leadgen_id: nullableText,
  meta_form_id: nullableText,
  meta_page_id: nullableText,
  meta_ad_id: nullableText,
  meta_ad_name: nullableText,
  meta_adset_id: nullableText,
  meta_adset_name: nullableText,
  meta_campaign_id: nullableText,
  meta_campaign_name: nullableText,
  meta_enriched_at: nullableText,
  gclid: nullableText,
  gbraid: nullableText,
  wbraid: nullableText,
  utm_source: nullableText,
  utm_medium: nullableText,
  utm_campaign: nullableText,
  utm_content: nullableText,
  utm_term: nullableText,
});
const leadSchema = z.object({
  crm_lead_id: z.number(),
  nome: z.string(),
  telefone: nullableText,
  origem: z.string(),
  criado_em: nullableText,
  atualizado_em: nullableText,
  id_empreendimento: z.number().nullable(),
  empreendimento: nullableText,
  status: nullableText,
  crm_stage_id: z.number().nullable(),
  etapa_crm: nullableText,
  qualificado: z.number().nullable(),
  lead_quente: z.boolean().nullable(),
  lead_conversa_id: z.number().nullable(),
  lead_conversa_ids: z.array(z.number()),
  interacoes_registradas: z.number().nullable(),
  houve_conversa: z.boolean().nullable(),
  ultima_mensagem_em: nullableText,
  ultimo_autor: nullableText,
  temperatura: nullableText,
  classificado_em: nullableText,
  atribuicoes: z.array(attributionSchema),
  cv_lead_ids: z.array(z.string()),
});

export async function getReportingLeads(
  input: z.infer<typeof reportingQuerySchema>,
  includePhone = false,
) {
  const period = reportPeriod(input.data_inicio, input.data_fim, input.fuso);
  const { data, error } = await reportingDb.rpc("crm_reporting_lead_page", {
    p_empresa: input.id_empresa,
    p_start: period.start,
    p_end: period.end,
    p_before: input.antes_de_id,
    p_limit: input.limite,
  });
  if (error) throw new Error("Falha ao consultar os dados do relatório");
  const rows = z.array(leadSchema).parse(data);
  const hasMore = rows.length > input.limite;
  const page = rows.slice(0, input.limite);
  const tagsByLead = await getReportingTags(
    input.id_empresa,
    page.map((lead) => lead.crm_lead_id),
  );
  const leads = await Promise.all(
    page.map(async ({ telefone, ...lead }) => {
      const attribution = chooseAttribution(lead.atribuicoes);
      return {
        ...lead,
        tags: tagsByLead.get(lead.crm_lead_id) ?? [],
        ...(includePhone ? { telefone } : {}),
        status_crm: lead.status,
        origem_descricao: getLeadOriginLabel(lead.origem),
        chave_pessoa: await reportPersonKey(telefone),
        source_type: attribution?.source_type ?? null,
        meta_leadgen_id: attribution?.meta_leadgen_id ?? null,
        meta_leadgen_ids: [
          ...new Set(
            lead.atribuicoes.map((a) => a.meta_leadgen_id).filter((id): id is string => !!id),
          ),
        ],
        meta_ad_id: attribution?.meta_ad_id ?? null,
        meta_ad_name: attribution?.meta_ad_name ?? null,
        meta_adset_id: attribution?.meta_adset_id ?? null,
        meta_adset_name: attribution?.meta_adset_name ?? null,
        meta_campaign_id: attribution?.meta_campaign_id ?? null,
        meta_campaign_name: attribution?.meta_campaign_name ?? null,
        cv_lead_id: lead.cv_lead_ids.length === 1 ? lead.cv_lead_ids[0] : null,
        cv_vinculo_ambiguo: lead.cv_lead_ids.length > 1,
      };
    }),
  );
  return {
    versao: "1",
    id_empresa: input.id_empresa,
    data_inicio: input.data_inicio,
    data_fim: input.data_fim,
    fuso: input.fuso,
    consultado_em: new Date().toISOString(),
    total_retornado: leads.length,
    tem_mais: hasMore,
    proximo_antes_de_id: hasMore ? page.at(-1)!.crm_lead_id : null,
    criterios: {
      periodo: "criação do lead; situação e atendimento consultados no momento da requisição",
      atribuicao:
        "prioriza ID de anúncio, depois leadgen_id, depois a entrada mais recente; histórico preservado em atribuicoes",
      conversa:
        "true quando há mensagem vinculada ou interação registrada; null quando não há evidência suficiente",
      ultimo_autor:
        "cliente ou ia conforme o tipo da mensagem vinculada; não identifica atendimento humano da equipe",
      temperatura:
        "classificação salva, quando existir; senão quente apenas quando lead_quente=true",
      chave_pessoa:
        "phone_v1_ + SHA-256 UTF-8 de phone:v1:<telefone normalizado>; consulte a documentação",
      cv: "IDs extraídos das respostas de envios bem-sucedidos ao CV; múltiplos IDs ficam no array",
      tags: "tags atuais vinculadas ao lead na mesma empresa; ausência de Sem Whatsapp não comprova que o telefone possui WhatsApp",
    },
    leads,
  };
}

export async function getReportingTags(companyId: number, leadIds: number[]) {
  const tagSchema = z.object({
    id: z.number(),
    nome: z.string(),
    cor: nullableText,
    global_tag_id: z.number().nullable(),
  });
  const tagsByLead = new Map<number, z.infer<typeof tagSchema>[]>();
  if (!leadIds.length) return tagsByLead;
  // Scope both the owning lead and the tag. A malformed cross-company link must not leak.
  const result = await reportingDb
    .from("crm_leads")
    .select("id,crm_lead_tags(crm_tags!inner(id,nome,cor,global_tag_id))")
    .eq("id_empresa", companyId)
    .eq("crm_lead_tags.crm_tags.id_empresa", companyId)
    .in("id", leadIds)
    .limit(100);
  if (result.error) throw new Error("Falha ao consultar tags dos leads");
  const rows = z
    .array(
      z.object({
        id: z.number(),
        crm_lead_tags: z.array(z.object({ crm_tags: tagSchema.nullable() })),
      }),
    )
    .parse(result.data);
  for (const row of rows) {
    const tags = row.crm_lead_tags.flatMap((link) => (link.crm_tags ? [link.crm_tags] : []));
    tagsByLead.set(
      row.id,
      [...new Map(tags.map((tag) => [tag.id, tag])).values()].sort((a, b) => a.id - b.id),
    );
  }
  return tagsByLead;
}

export async function getCvLeadIds(companyId: number, crmLeadId: number) {
  const result = await reportingDb
    .from("crm_external_crm_send_logs")
    .select("response_payload")
    .eq("id_empresa", companyId)
    .eq("lead_id", crmLeadId)
    .eq("provider", "cv_crm")
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (result.error) throw new Error("Falha ao consultar vínculo CV");
  return [
    ...new Set(
      (result.data ?? [])
        .map((row) => cvIdFromResponse(row.response_payload))
        .filter((id): id is string => !!id),
    ),
  ];
}

type Authorization = { integration_id: string; empresa_ids: number[]; rate_allowed: boolean };
type Dependencies = {
  authorize: (hash: string) => Promise<Authorization | null>;
  query: (input: z.infer<typeof reportingQuerySchema>) => Promise<unknown>;
};

const defaultDependencies: Dependencies = {
  authorize: async (hash) => {
    const result = await reportingDb.rpc("crm_reporting_authorize", { p_hash: hash });
    if (result.error) throw new Error("Falha na autenticação da integração");
    return result.data?.[0] ?? null;
  },
  query: getReportingLeads,
};

export async function handleReportingRequest(request: Request, dependencies = defaultDependencies) {
  const respond = (body: unknown, status: number, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        Vary: "Authorization",
        "X-Content-Type-Options": "nosniff",
        ...extra,
      },
    });
  if (request.method !== "GET")
    return respond({ erro: "Método não permitido" }, 405, { Allow: "GET" });
  const match = /^Bearer (khr_[0-9a-f]{64})$/.exec(request.headers.get("authorization") ?? "");
  if (!match)
    return respond({ erro: "Token de integração ausente ou inválido" }, 401, {
      "WWW-Authenticate": "Bearer",
    });
  try {
    const identity = await dependencies.authorize(await sha256Hex(match[1]));
    if (!identity)
      return respond({ erro: "Token inválido, expirado ou revogado" }, 401, {
        "WWW-Authenticate": "Bearer",
      });
    if (!identity.rate_allowed)
      return respond({ erro: "Limite de 60 requisições por minuto atingido" }, 429, {
        "Retry-After": "60",
      });
    const parsed = reportingQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      return respond(
        { erro: "Parâmetros inválidos", campos: parsed.error.issues.map((i) => i.path.join(".")) },
        400,
      );
    if (!identity.empresa_ids.includes(parsed.data.id_empresa))
      return respond({ erro: "Empresa não autorizada para esta integração" }, 403);
    try {
      reportPeriod(parsed.data.data_inicio, parsed.data.data_fim, parsed.data.fuso);
    } catch (error) {
      return respond({ erro: error instanceof Error ? error.message : "Período inválido" }, 400);
    }
    return respond(await dependencies.query(parsed.data), 200);
  } catch {
    return respond({ erro: "Não foi possível consultar o relatório. Tente novamente." }, 503);
  }
}
