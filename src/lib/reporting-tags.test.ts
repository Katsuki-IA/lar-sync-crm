import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, from, select, eq, inIds, limit } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  inIds: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("./reporting-db.server", () => ({ reportingDb: { rpc, from } }));
import { getReportingLeads, getReportingTags } from "./reporting-api.server";

beforeEach(() => {
  vi.resetAllMocks();
  const chain = { select, eq, in: inIds, limit };
  for (const fn of [from, select, eq, inIds]) fn.mockReturnValue(chain);
  limit.mockResolvedValue({ data: [], error: null });
});

describe("reporting lead tags", () => {
  it("scopes both lead and tag to the company, returning stable ordered tags", async () => {
    const tag = { id: 48, nome: "Sem Whatsapp", cor: "#F97316", global_tag_id: 11 };
    limit.mockResolvedValue({
      data: [
        { id: 10, crm_lead_tags: [{ crm_tags: tag }, { crm_tags: tag }, { crm_tags: null }] },
        { id: 11, crm_lead_tags: [] },
      ],
      error: null,
    });
    const result = await getReportingTags(25, [10, 11]);
    expect(eq).toHaveBeenCalledWith("id_empresa", 25);
    expect(eq).toHaveBeenCalledWith("crm_lead_tags.crm_tags.id_empresa", 25);
    expect(inIds).toHaveBeenCalledWith("id", [10, 11]);
    expect(result.get(10)).toEqual([tag]);
    expect(result.get(11)).toEqual([]);
  });
  it("skips an empty page and does not hide database failures as empty tags", async () => {
    expect((await getReportingTags(25, [])).size).toBe(0);
    expect(from).not.toHaveBeenCalled();
    limit.mockResolvedValue({ data: null, error: { message: "failure" } });
    await expect(getReportingTags(25, [10])).rejects.toThrow("Falha ao consultar tags");
  });
  it("adds tags to report rows without exposing phones or changing pagination", async () => {
    const row = {
      crm_lead_id: 10,
      nome: "Teste",
      telefone: "5527991234567",
      origem: "WA",
      criado_em: null,
      atualizado_em: null,
      id_empreendimento: null,
      empreendimento: null,
      status: null,
      crm_stage_id: null,
      etapa_crm: null,
      qualificado: null,
      lead_quente: null,
      lead_conversa_id: null,
      lead_conversa_ids: [],
      interacoes_registradas: null,
      houve_conversa: null,
      ultima_mensagem_em: null,
      ultimo_autor: null,
      temperatura: null,
      classificado_em: null,
      atribuicoes: [],
      cv_lead_ids: [],
    };
    rpc.mockResolvedValue({ data: [row, { ...row, crm_lead_id: 9 }], error: null });
    const tag = { id: 48, nome: "Sem Whatsapp", cor: null, global_tag_id: 11 };
    limit.mockResolvedValue({
      data: [{ id: 10, crm_lead_tags: [{ crm_tags: tag }] }],
      error: null,
    });
    const result = await getReportingLeads({
      id_empresa: 25,
      data_inicio: "2026-09-09",
      data_fim: "2026-09-15",
      fuso: "UTC",
      limite: 1,
    });
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0].tags).toEqual([tag]);
    expect(result.leads[0]).not.toHaveProperty("telefone");
    expect(result.leads[0].chave_pessoa).toMatch(/^phone_v1_[a-f0-9]{64}$/);
    expect(result.tem_mais).toBe(true);
    expect(result.proximo_antes_de_id).toBe(10);
    expect(inIds).toHaveBeenCalledWith("id", [10]);
  });
});
