type MaestroInput = {
  url: string; token: string; companyId: number; leadId: number;
  name: string; phone: string; email: string; pipelineId: string | number;
  stageId: string | number; tags: string[]; summary?: string;
};

function positiveId(value: unknown, label: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Maestro: ${label} inválido ou não configurado.`);
  return id;
}

// Contract follows [Maestro CRM] Nature. The HUB ID stays local; external_id is the conversation ID.
export async function dispatchMaestro(input: MaestroInput, request: typeof fetch = fetch) {
  const base = new URL(input.url || "https://crm.maestroia.com.br/api/v1");
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("Maestro: URL HTTPS inválida.");
  }
  if (!input.token.trim()) throw new Error("Maestro: token não configurado.");
  const pipeline = positiveId(input.pipelineId, "funil");
  const stage = positiveId(input.stageId, "etapa");
  const phone = input.phone.replace(/\D/g, "");
  if (!phone) throw new Error("Maestro: telefone ausente; envio não realizado.");
  const key = `katsuki_${input.companyId}_${phone}`;
  const requestPayload: Record<string, unknown> = {};
  async function api(path: string, method = "GET", body?: Record<string, unknown>) {
    const response = await request(base.toString().replace(/\/+$/, "") + path, {
      method, redirect: "error", signal: AbortSignal.timeout(25000),
      headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error(`Maestro: resposta inválida (${response.status}).`); }
    if (!response.ok || result?.error || result?.success === false || result?.ok === false) {
      // Do not expose tokens or arbitrary remote response contents in logs.
      throw new Error(`Maestro: falha em ${method} ${path.split('?')[0]} (${response.status}).`);
    }
    return result;
  }
  const personBody: Record<string, unknown> = {
    nome: input.name.trim() || "Lead WhatsApp", telefone: phone, origem: "whatsapp",
    provedor_integracao: "katsuki", lead_externo_id: key, tags: input.tags, upsert: true,
  };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) && !/^provisorio\+/i.test(input.email.trim())) {
    personBody.email = input.email.trim();
  }
  requestPayload.pessoa = personBody;
  const person = await api("/pessoas", "POST", personBody);
  const personId = positiveId(person?.pessoa?.id, "ID da pessoa retornado");
  const list = await api(`/pessoas/${personId}/conversas?ordenar=ultimo_contato&limit=1`);
  if (!Array.isArray(list?.conversas)) throw new Error("Maestro: lista de conversas inválida; criação interrompida.");
  const existing = list.conversas[0];
  let conversationId: number;
  const stageBody = { funil_id: pipeline, stage_id: stage };
  if (existing) {
    conversationId = positiveId(existing.id, "ID da conversa existente");
    const body = { ...stageBody, ...(existing.status === "em_aberto" ? {} : { status: "em_aberto" }) };
    requestPayload.conversa = body;
    await api(`/conversas/${conversationId}`, "PATCH", body);
  } else {
    const body = { ...stageBody, pessoa_id: personId, canal: "whatsapp", provedor: "katsuki",
      conversa_externa_id: key, contato_identificador: phone };
    requestPayload.conversa = body;
    const created = await api("/conversas", "POST", body);
    conversationId = positiveId(created?.conversa?.id ?? created?.id, "ID da conversa criada");
  }
  // A 2xx alone is not evidence that the requested stage was applied.
  const readback = await api(`/conversas/${conversationId}`);
  const conversation = readback?.conversa;
  if (Number(conversation?.id) !== conversationId || Number(conversation?.pessoa_id) !== personId ||
      Number(conversation?.funil_id) !== pipeline || Number(conversation?.stage_id) !== stage ||
      conversation?.status !== "em_aberto") {
    throw new Error("Maestro: conversa ou etapa não confirmada na leitura; revisar antes de reenviar.");
  }
  let summarySynced = false;
  let summaryError: string | null = null;
  if (input.summary?.trim()) {
    const note = { telefone_e164: `+${phone}`, tipo: "nota", canal: "whatsapp",
      provedor: conversation.provedor || "katsuki", conversa_externa_id: conversation.conversa_externa_id || key,
      externo_id: `katsuki_hub_${input.companyId}_${input.leadId}_${conversationId}_${stage}`,
      conteudo: input.summary, ocorrido_em: new Date().toISOString() };
    requestPayload.nota = note;
    try { await api("/interacoes", "POST", note); summarySynced = true; }
    catch (error) { summaryError = error instanceof Error ? error.message : "Maestro: falha ao registrar resumo."; }
  }
  return { externalId: String(conversationId), requestPayload,
    responsePayload: { pessoa_id: personId, conversa_id: conversationId, funil_id: pipeline, stage_id: stage, reused: Boolean(existing) },
    summarySynced, summaryError };
}
