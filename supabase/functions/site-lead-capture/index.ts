import { createSupabaseAdmin } from "../_shared/meta.ts";
import { normalizeBrazilPhone } from "../_shared/meta-lead.ts";
import { resolveLeadOrigin } from "../_shared/lead-origin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hub-form-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SiteLeadSource = {
  id: string;
  id_empresa: number;
  id_empreendimento: number;
  nome: string;
  token: string;
  allowed_domains: string[] | null;
  origem: string | null;
  field_mapping: Record<string, unknown> | null;
  active: boolean;
};

type IngestResult = {
  lead_id: number;
  inserted: boolean;
  event_id: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map(valueToString).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "text", "raw_value", "label", "name"]) {
      const text = valueToString(record[key]);
      if (text) return text;
    }
    return Object.values(record).map(valueToString).filter(Boolean).join(", ");
  }
  return "";
}

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const parsed = await req.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  }
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const output: Record<string, unknown> = {};
    for (const [key, value] of formData.entries()) {
      output[key] = typeof value === "string" ? value : value.name;
    }
    return output;
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(await req.text());
    const output: Record<string, unknown> = {};
    for (const [key, value] of params.entries()) output[key] = value;
    return output;
  }

  const raw = await req.text();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { raw };
  }
}

function addField(fields: Map<string, string>, key: string, value: unknown) {
  const text = valueToString(value);
  if (!key || !text) return;
  fields.set(key, text);
  fields.set(key.toLowerCase(), text);
  fields.set(normalizeKey(key), text);
}

function flattenPayload(payload: Record<string, unknown>) {
  const fields = new Map<string, string>();

  for (const [key, value] of Object.entries(payload)) {
    addField(fields, key, value);

    const bracketMatch = key.match(/^form_fields\[(.+)]$/);
    if (bracketMatch?.[1]) addField(fields, bracketMatch[1], value);
  }

  const formFields = payload.form_fields;
  if (formFields && typeof formFields === "object" && !Array.isArray(formFields)) {
    for (const [key, value] of Object.entries(formFields as Record<string, unknown>)) {
      addField(fields, key, value);
    }
  }

  const fieldsPayload = payload.fields;
  if (Array.isArray(fieldsPayload)) {
    for (const field of fieldsPayload) {
      if (!field || typeof field !== "object") continue;
      const record = field as Record<string, unknown>;
      const key = valueToString(record.id ?? record.name ?? record.title ?? record.label);
      addField(fields, key, record.value ?? record.raw_value ?? record.text);
    }
  } else if (fieldsPayload && typeof fieldsPayload === "object") {
    for (const [key, value] of Object.entries(fieldsPayload as Record<string, unknown>)) {
      addField(fields, key, value);
    }
  }

  return fields;
}

function getMappedValue(args: {
  fields: Map<string, string>;
  mapping: Record<string, unknown> | null;
  crmField: "nome" | "telefone" | "email";
  aliases: string[];
  pattern: RegExp;
}) {
  const mapping = args.mapping ?? {};
  const mappedKey = mapping[args.crmField];
  if (typeof mappedKey === "string") {
    const direct =
      args.fields.get(mappedKey) ??
      args.fields.get(mappedKey.toLowerCase()) ??
      args.fields.get(normalizeKey(mappedKey));
    if (direct) return direct;
  }

  for (const [sourceKey, crmField] of Object.entries(mapping)) {
    if (crmField !== args.crmField) continue;
    const mapped =
      args.fields.get(sourceKey) ??
      args.fields.get(sourceKey.toLowerCase()) ??
      args.fields.get(normalizeKey(sourceKey));
    if (mapped) return mapped;
  }

  for (const alias of args.aliases) {
    const value = args.fields.get(alias) ?? args.fields.get(normalizeKey(alias));
    if (value) return value;
  }

  for (const [key, value] of args.fields.entries()) {
    if (args.pattern.test(normalizeKey(key))) return value;
  }

  return "";
}

function getRequestToken(req: Request, payload: Record<string, unknown>) {
  const url = new URL(req.url);
  return (
    req.headers.get("x-hub-form-token") ??
    url.searchParams.get("token") ??
    valueToString(payload.token) ??
    valueToString(payload.hub_token)
  ).trim();
}

function getRequestHost(req: Request) {
  for (const header of ["origin", "referer"] as const) {
    const value = req.headers.get(header);
    if (!value) continue;
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      continue;
    }
  }
  return "";
}

function normalizeDomain(domain: string) {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

function hostMatchesAllowedDomain(host: string, allowedDomain: string) {
  const normalizedHost = normalizeDomain(host);
  const normalizedAllowed = normalizeDomain(allowedDomain);
  if (!normalizedHost || !normalizedAllowed) return false;
  if (normalizedAllowed.startsWith("*.")) {
    const suffix = normalizedAllowed.slice(2);
    return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
  }
  return normalizedHost === normalizedAllowed || normalizedHost.endsWith(`.${normalizedAllowed}`);
}

function domainIsAllowed(host: string, allowedDomains: string[] | null) {
  const domains = (allowedDomains ?? []).map(normalizeDomain).filter(Boolean);
  if (domains.length === 0 || !host) return true;
  return domains.some((domain) => hostMatchesAllowedDomain(host, domain));
}

function createObservacoes(source: SiteLeadSource, fields: Map<string, string>) {
  const explicit =
    fields.get("observacoes") ??
    fields.get("mensagem") ??
    fields.get("message") ??
    fields.get("comentario") ??
    fields.get("comments");
  return explicit || `Lead recebido via formulário externo: ${source.nome}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido" }, 405);

  const supabaseAdmin = createSupabaseAdmin();
  let source: SiteLeadSource | null = null;

  try {
    const payload = await parseBody(req);
    const token = getRequestToken(req, payload);
    if (!token) return jsonResponse({ error: "Token obrigatório" }, 401);

    const { data: sourceData, error: sourceError } = await supabaseAdmin
      .from("crm_site_lead_sources")
      .select(
        "id,id_empresa,id_empreendimento,nome,token,allowed_domains,origem,field_mapping,active",
      )
      .eq("token", token)
      .eq("active", true)
      .maybeSingle();

    if (sourceError) throw new Error(sourceError.message);
    if (!sourceData) return jsonResponse({ error: "Fonte não autorizada" }, 401);
    source = sourceData as SiteLeadSource;

    const requestHost = getRequestHost(req);
    if (!domainIsAllowed(requestHost, source.allowed_domains)) {
      return jsonResponse({ error: "Domínio não autorizado para esta fonte" }, 403);
    }

    const fields = flattenPayload(payload);
    const nome = getMappedValue({
      fields,
      mapping: source.field_mapping,
      crmField: "nome",
      aliases: ["nome", "name", "full_name", "nome_completo", "lead_nome", "your_name"],
      pattern: /(^|_)(nome|name|full_name|nome_completo)(_|$)/,
    });
    const telefoneOriginal = getMappedValue({
      fields,
      mapping: source.field_mapping,
      crmField: "telefone",
      aliases: [
        "telefone",
        "phone",
        "phone_number",
        "celular",
        "whatsapp",
        "mobile",
        "tel",
        "fone",
      ],
      pattern: /(^|_)(telefone|phone|phone_number|celular|mobile|whatsapp|fone|tel)(_|$)/,
    });
    const email = getMappedValue({
      fields,
      mapping: source.field_mapping,
      crmField: "email",
      aliases: ["email", "e_mail", "email_address", "your_email"],
      pattern: /(^|_)(email|e_mail|email_address)(_|$)/,
    });

    const telefone = normalizeBrazilPhone(telefoneOriginal).normalized;
    if (!telefone) return jsonResponse({ error: "Telefone obrigatório" }, 400);

    const origem = resolveLeadOrigin(
      payload.origem ?? payload.source ?? payload.utm_source ?? source.origem ?? "SI",
      payload.modulo,
    );
    const externalId =
      valueToString(payload.external_id) ||
      valueToString(payload.submission_id) ||
      valueToString(payload.id) ||
      valueToString(payload.form_id);

    const { data: ingestData, error: ingestError } = await supabaseAdmin.rpc(
      "crm_ingest_site_lead",
      {
        p_source_id: source.id,
        p_id_empresa: source.id_empresa,
        p_id_empreendimento: source.id_empreendimento,
        p_nome: nome || "Lead sem nome",
        p_telefone: telefone,
        p_email: email || null,
        p_origem: origem,
        p_observacoes: createObservacoes(source, fields),
        p_raw_data: {
          payload,
          fields: Object.fromEntries(fields.entries()),
          request_host: requestHost || null,
          telefone_original: telefoneOriginal || null,
        },
        p_external_id: externalId || null,
      },
    );

    if (ingestError) throw new Error(ingestError.message);
    const result = Array.isArray(ingestData) ? (ingestData[0] as IngestResult | undefined) : null;

    return jsonResponse({
      ok: true,
      lead_id: result?.lead_id ?? null,
      inserted: result?.inserted ?? false,
      event_id: result?.event_id ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno";
    console.error("Falha ao receber lead de site", error);
    if (source?.id) {
      await supabaseAdmin
        .from("crm_site_lead_sources")
        .update({ last_error: message })
        .eq("id", source.id);
    }
    return jsonResponse({ error: message }, 400);
  }
});
