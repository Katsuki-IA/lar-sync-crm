import {
  createSupabaseAdmin,
  getMetaConfig,
  jsonResponse,
} from "../_shared/meta.ts";
import {
  createMetaFieldValueMap,
  getMappedMetaValue,
  normalizeBrazilPhone,
  type MetaLeadFieldData,
} from "../_shared/meta-lead.ts";

type LeadgenValue = {
  leadgen_id?: string;
  page_id?: string;
  form_id?: string;
  ad_id?: string;
  adgroup_id?: string;
  created_time?: number;
};

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    changes?: Array<{
      field?: string;
      value?: LeadgenValue;
    }>;
  }>;
};

type MetaLeadResponse = {
  id?: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  field_data?: MetaLeadFieldData[];
  custom_disclaimer_responses?: unknown;
  error?: {
    message?: string;
  };
};

function describeMetaFields(fieldData: MetaLeadFieldData[] | undefined) {
  return (fieldData ?? []).map((field) => ({
    name: field.name?.trim() || "(sem nome)",
    hasValue: (field.values ?? []).some(
      (value) => value !== null && value !== undefined && String(value).trim() !== "",
    ),
  }));
}

function textResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function hexToBytes(value: string) {
  if (!/^[0-9a-f]+$/iu.test(value) || value.length % 2 !== 0) return null;
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function isValidSignature(rawBody: string, signatureHeader: string | null, secret: string) {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const received = hexToBytes(signatureHeader.slice("sha256=".length));
  if (!received) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );
  return timingSafeEqual(expected, received);
}

async function getDefaultRouting(supabaseAdmin: ReturnType<typeof createSupabaseAdmin>, idEmpresa: number) {
  const { data: manager, error: managerError } = await supabaseAdmin
    .from("crm_users")
    .select("id")
    .eq("id_empresa", idEmpresa)
    .eq("role", "manager")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (managerError) throw new Error(managerError.message);

  const { data: defaultFunnel, error: funnelError } = await supabaseAdmin
    .from("crm_funnels")
    .select("id")
    .eq("id_empresa", idEmpresa)
    .eq("is_default", true)
    .maybeSingle();
  if (funnelError) throw new Error(funnelError.message);

  let stagesQuery = supabaseAdmin
    .from("crm_stages")
    .select("id")
    .eq("id_empresa", idEmpresa)
    .eq("ativo", true)
    .order("ordem", { ascending: true })
    .limit(1);
  if (defaultFunnel?.id) {
    stagesQuery = stagesQuery.eq("id_funnel", defaultFunnel.id);
  }
  const { data: stage, error: stageError } = await stagesQuery.maybeSingle();
  if (stageError) throw new Error(stageError.message);

  return {
    assignedTo: manager?.id ?? null,
    stageId: stage?.id ?? null,
  };
}

async function processLeadgenEvent(args: {
  entryId: string | null;
  entryTime: number | null;
  value: LeadgenValue;
}) {
  const leadId = args.value.leadgen_id;
  const formId = args.value.form_id;
  const pageId = args.value.page_id;
  if (!leadId || !formId || !pageId) {
    throw new Error("Evento leadgen sem leadgen_id, form_id ou page_id");
  }

  const supabaseAdmin = createSupabaseAdmin();
  const { graphVersion } = getMetaConfig(false);
  const { data: form, error: formError } = await supabaseAdmin
    .from("crm_meta_forms")
    .select(
      "id_empresa,form_id,form_name,page_id,page_name,page_access_token,id_empreendimento,connection_id",
    )
    .eq("form_id", formId)
    .eq("page_id", pageId)
    .eq("active", true)
    .maybeSingle();
  if (formError) throw new Error(formError.message);
  if (!form) {
    console.info(`Evento Meta ignorado: formulário ${formId} não está ativo no CRM`);
    return { ignored: true, inserted: false, leadId: null };
  }
  if (!form.id_empreendimento) {
    throw new Error(`Formulário ${formId} sem empreendimento configurado`);
  }

  const { data: connection, error: connectionError } = await supabaseAdmin
    .from("crm_meta_connections")
    .select("active,user_access_token")
    .eq("id", form.connection_id)
    .eq("id_empresa", form.id_empresa)
    .maybeSingle();
  if (connectionError) throw new Error(connectionError.message);
  if (!connection?.active) {
    console.info(`Evento Meta ignorado: conexão da empresa ${form.id_empresa} está inativa`);
    return { ignored: true, inserted: false, leadId: null };
  }

  const accessToken = form.page_access_token ?? connection.user_access_token;
  if (!accessToken) throw new Error(`Token de acesso ausente para a página ${pageId}`);

  const leadUrl = new URL(`https://graph.facebook.com/${graphVersion}/${leadId}`);
  leadUrl.searchParams.set(
    "fields",
    "id,created_time,ad_id,form_id,field_data,custom_disclaimer_responses",
  );
  leadUrl.searchParams.set("access_token", accessToken);
  const leadResponse = await fetch(leadUrl.toString());
  const lead = (await leadResponse.json()) as MetaLeadResponse;
  if (!leadResponse.ok || lead.error || !lead.id) {
    throw new Error(lead.error?.message ?? `Falha ao buscar lead Meta ${leadId}`);
  }
  if (lead.form_id && lead.form_id !== formId) {
    throw new Error(`Lead ${leadId} pertence a outro formulário`);
  }

  const { data: mappings, error: mappingError } = await supabaseAdmin
    .from("crm_meta_field_mapping")
    .select("meta_field_key,crm_field")
    .eq("id_empresa", form.id_empresa)
    .eq("form_id", formId);
  if (mappingError) throw new Error(mappingError.message);
  const mapping = Object.fromEntries(
    (mappings ?? []).map((item) => [item.meta_field_key, item.crm_field]),
  );
  const values = createMetaFieldValueMap(lead.field_data ?? []);
  const nome = getMappedMetaValue({ values, mapping, crmField: "nome" }).trim();
  const telefoneOriginal = getMappedMetaValue({ values, mapping, crmField: "telefone" }).trim();
  const telefoneNormalizado = normalizeBrazilPhone(telefoneOriginal);
  if (!nome) throw new Error(`Lead ${leadId} sem Nome conforme o mapeamento`);
  if (!telefoneNormalizado.normalized) {
    const receivedFields = describeMetaFields(lead.field_data);
    console.warn("Lead Meta sem telefone mapeável", {
      leadId,
      formId,
      receivedFields,
    });
    const fieldSummary = receivedFields
      .map((field) => `${field.name}:${field.hasValue ? "com valor" : "vazio"}`)
      .join(", ");
    throw new Error(
      `Lead ${leadId} sem Telefone conforme o mapeamento. Campos recebidos: ${fieldSummary || "nenhum"}`,
    );
  }

  const email = getMappedMetaValue({ values, mapping, crmField: "email" }).trim() || null;
  const origem =
    getMappedMetaValue({ values, mapping, crmField: "origem" }).trim() || "Meta Lead Ads";
  const observacoes =
    getMappedMetaValue({ values, mapping, crmField: "observacoes" }).trim() || null;
  const routing = await getDefaultRouting(supabaseAdmin, form.id_empresa);
  const rawData = {
    source: "meta_webhook",
    webhook: {
      entry_id: args.entryId,
      entry_time: args.entryTime,
      value: args.value,
    },
    lead,
    destination: {
      id_empresa: form.id_empresa,
      id_empreendimento: form.id_empreendimento,
    },
    normalized_fields: {
      telefone: {
        original: telefoneNormalizado.original,
        digits: telefoneNormalizado.digits,
        normalized: telefoneNormalizado.normalized,
        default_country_code: "55",
      },
    },
    processed_at: new Date().toISOString(),
  };

  const { data: ingestion, error: ingestionError } = await supabaseAdmin.rpc(
    "crm_ingest_meta_lead",
    {
      p_id_empresa: form.id_empresa,
      p_form_id: formId,
      p_lead_id_meta: leadId,
      p_nome: nome,
      p_email: email,
      p_telefone: telefoneNormalizado.normalized,
      p_raw_data: rawData,
      p_origem: origem,
      p_observacoes: observacoes,
      p_id_empreendimento: form.id_empreendimento,
      p_crm_stage_id: routing.stageId,
      p_crm_assigned_to: routing.assignedTo,
    },
  );
  if (ingestionError) throw new Error(ingestionError.message);
  const result = Array.isArray(ingestion) ? ingestion[0] : ingestion;

  return {
    ignored: false,
    inserted: Boolean(result?.was_inserted),
    leadId: result?.created_lead_id ?? null,
  };
}

async function handlePost(req: Request) {
  const { appSecret } = getMetaConfig();
  const rawBody = await req.text();
  if (!(await isValidSignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret))) {
    return jsonResponse({ error: "Assinatura do webhook inválida" }, 401);
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    return jsonResponse({ error: "Payload JSON inválido" }, 400);
  }
  if (payload.object !== "page") {
    return jsonResponse({ received: true, ignored: true });
  }

  const events = (payload.entry ?? []).flatMap((entry) =>
    (entry.changes ?? [])
      .filter((change) => change.field === "leadgen" && change.value)
      .map((change) => ({
        entryId: entry.id ?? null,
        entryTime: entry.time ?? null,
        value: change.value!,
      })),
  );

  try {
    const results = [];
    for (const event of events) {
      results.push(await processLeadgenEvent(event));
    }
    return jsonResponse({ received: true, events: events.length, results });
  } catch (error) {
    console.error("Falha ao processar webhook Meta", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Falha ao processar webhook Meta" },
      500,
    );
  }
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const challenge = url.searchParams.get("hub.challenge");
    const token = url.searchParams.get("hub.verify_token");
    const verifyToken = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") ?? "";

    if (mode === "subscribe" && challenge && verifyToken && token === verifyToken) {
      return textResponse(challenge);
    }
    return textResponse("Verificação inválida", 403);
  }

  if (req.method === "POST") return handlePost(req);
  return textResponse("Método não permitido", 405);
});
