// Shared by configuration, dispatch and the reconciliation worker. No tenant-specific rules.
// deno-lint-ignore-file no-explicit-any
export const STANDARD_FIELD = "Empreendimento de interesse";
export const UNKNOWN_PROJECT = "Não definido";
export type Project = { id: number; nome: string };
export type KommoField = {
  id: number;
  name: string;
  type: string;
  enums: { id: number; value: string; sort?: number }[] | null;
};
export type ProjectConfig = {
  id_empresa: number;
  enabled: boolean;
  account_url: string;
  account_id: number | null;
  field_id: number | null;
  field_name: string;
  mappings: Record<string, number>;
  unknown_enum_id: number | null;
  unknown_policy: "undefined" | "block";
  auto_create_options: boolean;
  sync_interest: boolean;
};
export function positiveId(value: unknown): number | null {
  const id =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
export function kommoBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.kommo\.com$/i.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !["", "/"].includes(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error("Configure uma URL HTTPS válida da conta Kommo.");
  return url.origin;
}
export const normalizedName = (name: string) =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
export function findOption(field: KommoField, name: string): number | null {
  const matches = (field.enums ?? []).filter(
    (e) => normalizedName(e.value) === normalizedName(name),
  );
  if (matches.length > 1)
    throw new Error(`Há opções duplicadas para “${name}”. Escolha a opção no mapeamento.`);
  return matches[0]?.id ?? null;
}
export function selectProject(focus: unknown, origin: unknown, projects: Project[]): number | null {
  // An ID from another tenant is an error, never a reason to silently choose another project.
  const id = positiveId(focus) ?? positiveId(origin);
  if (id !== null && !projects.some((p) => p.id === id))
    throw new Error("O empreendimento do lead não pertence à empresa.");
  return id;
}
export function projectFieldValue(config: ProjectConfig, projectId: number | null) {
  if (!config.enabled) return null;
  if (!positiveId(config.field_id))
    throw new Error("Campo de empreendimento do Kommo não configurado.");
  if (projectId === null && config.unknown_policy === "block")
    throw new Error("Envio pendente: defina o empreendimento de interesse do lead.");
  const enumId = projectId === null ? config.unknown_enum_id : config.mappings[String(projectId)];
  if (!positiveId(enumId))
    throw new Error(
      "Empreendimento sem mapeamento no Kommo. Sincronize as opções em Envio ao CRM.",
    );
  return { field_id: config.field_id!, values: [{ enum_id: enumId! }] };
}
export function mayUpdateRemote(
  current: number | null,
  desired: number,
  previous: number | null,
  tracked: boolean,
) {
  if (current === desired) return "unchanged";
  if (!tracked) return current === null ? "update" : "conflict";
  return current === previous ? "update" : "conflict";
}
export class KommoApi {
  base: string;
  constructor(
    base: string,
    private token: string,
    private transport: typeof fetch = fetch,
  ) {
    this.base = kommoBaseUrl(base);
  }
  async request(path: string, method = "GET", body?: unknown): Promise<any> {
    if (!path.startsWith("/api/v4/")) throw new Error("Rota Kommo inválida");
    const response = await this.transport(this.base + path, {
      method,
      redirect: "error",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 403
          ? "A conexão Kommo não tem permissão. A criação de campos e opções exige administrador."
          : `Kommo retornou HTTP ${response.status}. Verifique a conexão e tente novamente.`,
      );
    return response.status === 204 ? null : response.json();
  }
  async fields(): Promise<KommoField[]> {
    const fields: KommoField[] = [];
    for (let page = 1; page <= 40; page++) {
      const result = await this.request(`/api/v4/leads/custom_fields?limit=250&page=${page}`);
      fields.push(...(result?._embedded?.custom_fields ?? []));
      if (!result?._links?.next) return fields;
    }
    throw new Error("A conta possui mais campos do que o limite de consulta.");
  }
}
export async function companyContext(db: any, companyId: number) {
  const [company, credentials, projects] = await Promise.all([
    db.from("empresa_dados").select("id,default_crm").eq("id", companyId).single(),
    db.from("credentials").select("cv_crm_url,cv_crm_token").eq("id_empresa", companyId).single(),
    db.from("empreendimento").select("id,nome").eq("id_empresa", companyId).order("nome"),
  ]);
  if (
    company.error ||
    !["kommo", "kommo_crm"].includes(company.data?.default_crm?.trim().toLowerCase())
  )
    throw new Error("A empresa não utiliza Kommo.");
  if (credentials.error || !credentials.data?.cv_crm_token)
    throw new Error("Credenciais Kommo não configuradas.");
  if (projects.error) throw new Error("Falha ao consultar os empreendimentos.");
  const api = new KommoApi(credentials.data.cv_crm_url, credentials.data.cv_crm_token);
  return { api, projects: (projects.data ?? []) as Project[] };
}
export async function loadConfig(db: any, companyId: number): Promise<ProjectConfig | null> {
  const { data, error } = await db
    .from("crm_kommo_project_settings")
    .select("*")
    .eq("id_empresa", companyId)
    .maybeSingle();
  if (error) throw new Error("Falha ao carregar configuração de empreendimentos Kommo.");
  return data;
}
export async function withCompanyLock<T>(
  db: any,
  companyId: number,
  fn: () => Promise<T>,
): Promise<T> {
  const token = crypto.randomUUID();
  const lock = await db.rpc("kommo_project_acquire_lock", { p_company: companyId, p_token: token });
  if (lock.error || lock.data !== true)
    throw new Error(
      "A sincronização desta empresa já está em andamento. Tente novamente em alguns minutos.",
    );
  try {
    return await fn();
  } finally {
    const released = await db.rpc("kommo_project_release_lock", {
      p_company: companyId,
      p_token: token,
    });
    if (released.error) console.error("Falha ao liberar sincronização Kommo", companyId);
  }
}
export async function provision(
  api: KommoApi,
  config: ProjectConfig,
  projects: Project[],
  createStandard = false,
): Promise<ProjectConfig> {
  const account = await api.request("/api/v4/account");
  if (config.account_url !== api.base || (config.account_id && config.account_id !== account.id))
    throw new Error("A conta Kommo mudou. Reconfigure o mapeamento antes de enviar leads.");
  let field: KommoField;
  if (config.field_id) {
    field = await api.request(`/api/v4/leads/custom_fields/${config.field_id}`);
  } else {
    if (!createStandard) throw new Error("Selecione um campo do Kommo.");
    const matches = (await api.fields()).filter(
      (f) => normalizedName(f.name) === normalizedName(STANDARD_FIELD),
    );
    if (matches.length > 1)
      throw new Error("Há mais de um campo com esse nome. Selecione o campo desejado.");
    if (matches.length) field = matches[0];
    else {
      const names = [
        ...new Set([
          ...projects.map((p) => p.nome),
          ...(config.unknown_policy === "undefined" ? [UNKNOWN_PROJECT] : []),
        ]),
      ];
      if (!names.length)
        throw new Error("Cadastre ao menos um empreendimento antes de configurar.");
      const result = await api.request("/api/v4/leads/custom_fields", "POST", [
        {
          name: STANDARD_FIELD,
          type: "select",
          enums: names.map((value, sort) => ({ value, sort })),
        },
      ]);
      field = result?._embedded?.custom_fields?.[0];
      if (!field?.id)
        throw new Error(
          "Kommo não confirmou a criação do campo. Consulte os campos antes de tentar novamente.",
        );
    }
  }
  if (field.type !== "select")
    throw new Error("Escolha um campo de seleção única para o empreendimento.");
  const mappings: Record<string, number> = {};
  const missing: string[] = [];
  for (const project of projects) {
    const saved = positiveId(config.mappings[String(project.id)]);
    if (saved && !(field.enums ?? []).some((e) => e.id === saved))
      throw new Error(`A opção mapeada para ${project.nome} foi removida. Corrija o mapeamento.`);
    const id = saved ?? findOption(field, project.nome);
    if (id) mappings[String(project.id)] = id;
    else missing.push(project.nome);
  }
  let unknown =
    config.unknown_policy === "undefined"
      ? (positiveId(config.unknown_enum_id) ?? findOption(field, UNKNOWN_PROJECT))
      : null;
  if (unknown && !(field.enums ?? []).some((e) => e.id === unknown))
    throw new Error("A opção Não definido foi removida. Reconfigure o campo.");
  if (config.unknown_policy === "undefined" && !unknown) missing.push(UNKNOWN_PROJECT);
  if (missing.length) {
    if (!config.auto_create_options && !createStandard)
      throw new Error(
        `Mapeie os empreendimentos e a opção Não definido antes de salvar. Faltam: ${missing.join(", ")}.`,
      );
    const additions = [...new Map(missing.map((n) => [normalizedName(n), n])).values()];
    const enums = (field.enums ?? []).map((e) => ({ id: e.id, value: e.value, sort: e.sort ?? 0 }));
    await api.request(`/api/v4/leads/custom_fields/${field.id}`, "PATCH", {
      enums: [...enums, ...additions.map((value, i) => ({ value, sort: enums.length + i }))],
    });
    field = await api.request(`/api/v4/leads/custom_fields/${field.id}`);
    for (const project of projects)
      if (!mappings[String(project.id)])
        mappings[String(project.id)] = findOption(field, project.nome)!;
    unknown =
      config.unknown_policy === "undefined"
        ? (unknown ?? findOption(field, UNKNOWN_PROJECT))
        : null;
  }
  const result = {
    ...config,
    account_id: account.id,
    field_id: field.id,
    field_name: field.name,
    mappings,
    unknown_enum_id: unknown,
  };
  if (new Set(Object.values(mappings)).size !== projects.length)
    throw new Error("Cada empreendimento precisa de uma opção diferente no Kommo.");
  if (unknown && Object.values(mappings).includes(unknown))
    throw new Error("Não definido não pode ser usado como opção de um empreendimento.");
  for (const project of projects) projectFieldValue({ ...result, enabled: true }, project.id);
  if (result.unknown_policy === "undefined") projectFieldValue({ ...result, enabled: true }, null);
  return result;
}
export async function saveConfig(db: any, config: ProjectConfig) {
  // Whitelist persisted fields: never copy a stale lease from a config snapshot.
  const {
    id_empresa,
    enabled,
    account_url,
    account_id,
    field_id,
    field_name,
    mappings,
    unknown_enum_id,
    unknown_policy,
    auto_create_options,
    sync_interest,
  } = config;
  const result = await db
    .from("crm_kommo_project_settings")
    .update({
      enabled,
      account_url,
      account_id,
      field_id,
      field_name,
      mappings,
      unknown_enum_id,
      unknown_policy,
      auto_create_options,
      sync_interest,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id_empresa", id_empresa);
  if (result.error) throw new Error("Não foi possível salvar o mapeamento do Kommo.");
}
export async function leadProject(
  db: any,
  companyId: number,
  lead: { id: number; id_empreendimento: number | null },
  projects: Project[],
  explicit?: number | null,
) {
  const context = await db
    .from("lead")
    .select("empreendimento_em_foco_id")
    .eq("id_empresa", companyId)
    .eq("id_crm", String(lead.id))
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (context.error) throw new Error("Falha ao consultar o interesse atual do lead.");
  return selectProject(
    explicit ?? context.data?.empreendimento_em_foco_id,
    lead.id_empreendimento,
    projects,
  );
}
export async function dispatchProjectField(
  db: any,
  companyId: number,
  lead: { id: number; id_empreendimento: number | null },
  explicit?: number | null,
) {
  let config = await loadConfig(db, companyId);
  if (!config?.enabled) return null;
  const { api, projects } = await companyContext(db, companyId);
  if (config.account_url !== api.base)
    throw new Error("A conta Kommo mudou. Reconfigure a identificação de empreendimento.");
  const projectId = await leadProject(db, companyId, lead, projects, explicit);
  if (projectId && !config.mappings[String(projectId)] && config.auto_create_options) {
    config = await withCompanyLock(db, companyId, async () => {
      const current = await loadConfig(db, companyId);
      if (!current?.enabled) throw new Error("Configuração Kommo desativada durante o envio.");
      const updated = await provision(api, current, projects);
      await saveConfig(db, updated);
      return updated;
    });
  }
  const value = projectFieldValue(config, projectId);
  return value ? { value, projectId, accountUrl: api.base } : null;
}
