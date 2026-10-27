import { describe, it, expect, vi } from "vitest";
import { assertBulkAllowed, CRM_EXPORT_PAGE, rowPermissions, isCrmExportSuccess, fetchCrmSentIds, pauseAiAttendance, startAiAttendance, deleteLead } from "./lead-row-actions";

// Chainable mock: every table call resolves to the queued result for that table; records operations.
function mockClient(results: Record<string, any[]>, rpcResult: any = { error: null }) {
  const calls: { table: string; ops: [string, any[]][] }[] = [];
  const client: any = {
    rpc: vi.fn(async () => rpcResult),
    from(table: string) {
      const entry = { table, ops: [] as [string, any[]][] };
      calls.push(entry);
      const result = () => (results[table] ?? []).shift() ?? { data: [], error: null };
      const b: any = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === "then") { const r = result(); return (res: any) => res(r); }
          return (...args: any[]) => { entry.ops.push([prop, args]); return b; };
        },
      });
      return b;
    },
  };
  return { client, calls };
}

describe("permissões da linha", () => {
  it("manager pausa IA ativa, mas não inicia atendimento", () => {
    expect(rowPermissions("manager", "active", "not_sent").canPauseAi).toBe(true);
    expect(rowPermissions("manager", "none", "not_sent").canStartAi).toBe(false);
  });
  it("só super_admin envia lead sem atendimento para a IA", () => {
    expect(rowPermissions("super_admin", "none", "not_sent").canStartAi).toBe(true);
    expect(rowPermissions("super_admin", "paused", "not_sent").canStartAi).toBe(false);
  });
  it("pausado mostra selo e não pode ser pausado nem iniciado", () => {
    const p = rowPermissions("super_admin", "paused", "not_sent");
    expect([p.showPausedBadge, p.canPauseAi, p.canStartAi]).toEqual([true, false, false]);
  });
  it("manager e super_admin excluem; agente não", () => {
    expect(rowPermissions("manager", "none", "not_sent").canDelete).toBe(true);
    expect(rowPermissions("super_admin", "none", "not_sent").canDelete).toBe(true);
    expect(rowPermissions("agent", "none", "not_sent").canDelete).toBe(false);
  });
  it("estágio/responsável só por super_admin", () => {
    expect(rowPermissions("manager", "none", "not_sent").canChangeStageOrOwner).toBe(false);
    expect(rowPermissions("super_admin", "none", "not_sent").canChangeStageOrOwner).toBe(true);
  });
  it("envio ao CRM some quando enviado e quando o status é desconhecido", () => {
    expect(rowPermissions("manager", "none", "sent").canSendCrm).toBe(false);
    expect(rowPermissions("manager", "none", "unknown").canSendCrm).toBe(false);
    expect(rowPermissions("manager", "none", "not_sent").canSendCrm).toBe(true);
  });
});

describe("evidência de envio ao CRM", () => {
  it("aceita só crm_export de sucesso", () => {
    expect(isCrmExportSuccess({ lead_id: 1, tipo: "crm_export", metadata: { event: "external_crm_sent" } })).toBe(true);
    expect(isCrmExportSuccess({ lead_id: 1, tipo: "crm_export", descricao: "Lead enviado ao CRM CV com sucesso" })).toBe(true);
    expect(isCrmExportSuccess({ lead_id: 1, tipo: "crm_export", metadata: { event: "external_crm_failed" }, descricao: "Falha" })).toBe(false);
    expect(isCrmExportSuccess({ lead_id: 1, tipo: "stage_change", metadata: { event: "external_crm_sent" } })).toBe(false);
  });
  it("consulta somente os IDs exibidos e propaga falha de leitura", async () => {
    const { client, calls } = mockClient({ crm_lead_activities: [{ data: [
      { lead_id: 5, tipo: "crm_export", metadata: { event: "external_crm_sent" } },
      { lead_id: 6, tipo: "crm_export", descricao: "tentativa com erro" },
    ], error: null }] });
    expect(await fetchCrmSentIds(client, [5, 6])).toEqual([5]);
    expect(calls[0].ops).toContainEqual(["in", ["lead_id", [5, 6]]]);
    const failing = mockClient({ crm_lead_activities: [{ data: null, error: new Error("negado") }] });
    await expect(fetchCrmSentIds(failing.client, [5])).rejects.toThrow("negado");
  });
});

describe("atendimento IA", () => {
  it("pausa pelo RPC com id do lead", async () => {
    const { client } = mockClient({});
    await pauseAiAttendance(client, 42);
    expect(client.rpc).toHaveBeenCalledWith("crm_pause_ai_attendance", { p_lead_id: 42 });
  });
  it("exige empreendimento", async () => {
    const { client, calls } = mockClient({ crm_leads: [{ data: { id: 1, id_empresa: 9, id_empreendimento: null }, error: null }] });
    await expect(startAiAttendance(client, { leadId: 1, companyId: 9, actorId: "u" })).rejects.toThrow("empreendimento");
    expect(calls.some((c) => c.table === "fila_leads")).toBe(false);
  });
  it("não reinsere lead já na fila", async () => {
    const { client, calls } = mockClient({
      crm_leads: [{ data: { id: 1, id_empresa: 9, id_empreendimento: 3 }, error: null }],
      lead: [{ data: [], error: null }],
      fila_leads: [{ data: [{ id: 77 }], error: null }],
    });
    await expect(startAiAttendance(client, { leadId: 1, companyId: 9, actorId: "u" })).rejects.toThrow("já está na fila");
    expect(calls.flatMap((c) => c.ops).some(([op]) => op === "insert")).toBe(false);
    const fila = calls.find((c) => c.table === "fila_leads")!;
    expect(fila.ops).toContainEqual(["eq", ["id_lead", "1"]]);
    expect(fila.ops).toContainEqual(["eq", ["id_empresa", 9]]);
  });
  it("insere na fila quando livre, escopado por empresa", async () => {
    const { client, calls } = mockClient({
      crm_leads: [{ data: { id: 1, id_empresa: 9, id_empreendimento: 3 }, error: null }],
      lead: [{ data: [], error: null }],
      fila_leads: [{ data: [], error: null }, { data: null, error: null }],
    });
    await startAiAttendance(client, { leadId: 1, companyId: 9, actorId: "u" });
    expect(calls[0].ops).toContainEqual(["eq", ["id_empresa", 9]]);
    const insert = calls.filter((c) => c.table === "fila_leads")[1].ops[0];
    expect(insert[1][0]).toMatchObject({ id_lead: "1", id_empresa: 9, id_empreendimento: 3, status: "pending" });
  });
});

describe("exclusão", () => {
  it("registra bloqueio quando o servidor não exclui nenhuma linha", async () => {
    const { client } = mockClient({ crm_leads: [{ data: [], error: null }] });
    await expect(deleteLead(client, 9, 1)).rejects.toThrow("não permitiu");
  });
});

describe("guarda do lote", () => {
  it("bloqueia estágio/responsável sem permissão e libera tags", () => {
    expect(() => assertBulkAllowed("stage", false)).toThrow("Somente superadministradores");
    expect(() => assertBulkAllowed("owner", false)).toThrow("Somente superadministradores");
    expect(() => assertBulkAllowed("tag_add", false)).toThrow("Tags IA");
    expect(() => assertBulkAllowed("tag_remove", true)).toThrow("Tags IA");
    expect(() => assertBulkAllowed("stage", true)).not.toThrow();
  });
});

describe("paginação de crm_export", () => {
  it("busca a página seguinte quando a primeira vem cheia", async () => {
    const full = Array.from({ length: CRM_EXPORT_PAGE }, (_, i) => ({ lead_id: 5, tipo: "crm_export", descricao: "falha " + i }));
    const { client, calls } = mockClient({ crm_lead_activities: [
      { data: full, error: null },
      { data: [{ lead_id: 5, tipo: "crm_export", metadata: { event: "external_crm_sent" } }], error: null },
    ] });
    expect(await fetchCrmSentIds(client, [5])).toEqual([5]);
    expect(calls.length).toBe(2);
    expect(calls[1].ops).toContainEqual(["range", [CRM_EXPORT_PAGE, 2 * CRM_EXPORT_PAGE - 1]]);
  });
});

