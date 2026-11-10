import { describe, expect, it } from "vitest";
import {
  buildGroupSavePlan,
  parseCommercialKey,
  splitCustomFieldsByGroup,
  type LeadCustomField,
} from "./lead-custom-fields";

const f = (id: number, commercial_key: string | null, tipo: LeadCustomField["tipo"] = "text"): LeadCustomField => ({
  id, id_empresa: 38, nome: `Campo ${id}`, tipo, obrigatorio: false, opcoes: [], ordem: id, ativo: true,
  commercial_key: parseCommercialKey(commercial_key),
});
const fields = [f(1, "empresa_cliente"), f(2, "site"), f(3, null), f(4, "cnpj_status"), f(5, "desconhecida")];

describe("dados comerciais", () => {
  it("aceita só as seis chaves comerciais", () => {
    for (const k of ["empresa_cliente", "site", "faturamento", "volume_whatsapp", "oferta", "cnpj_status"])
      expect(parseCommercialKey(k)).toBe(k);
    expect(parseCommercialKey("email")).toBeNull();
    expect(parseCommercialKey(undefined)).toBeNull();
  });

  it("separa comerciais dos personalizados; chave inválida ou ausente fica em personalizados", () => {
    const g = splitCustomFieldsByGroup(fields);
    expect(g.commercial.map((x) => x.id)).toEqual([1, 2, 4]);
    expect(g.custom.map((x) => x.id)).toEqual([3, 5]);
  });

  it("campos sem commercial_key (coluna ainda inexistente) ficam todos em personalizados", () => {
    const legacy = fields.map(({ commercial_key: _k, ...rest }) => rest as LeadCustomField);
    expect(splitCustomFieldsByGroup(legacy).commercial).toEqual([]);
  });

  it("salvar dados comerciais nunca grava nem apaga campos personalizados", () => {
    const { commercial } = splitCustomFieldsByGroup(fields);
    const plan = buildGroupSavePlan(10, commercial, { 1: "ACME", 2: "", 3: "não tocar", 5: "x" });
    expect(plan.upserts.map((r) => r.field_id)).toEqual([1]);
    expect(plan.deleteFieldIds).toEqual([2, 4]);
    const touched = [...plan.upserts.map((r) => r.field_id), ...plan.deleteFieldIds];
    expect(touched).not.toContain(3);
    expect(touched).not.toContain(5);
  });

  it("salvar personalizados nunca apaga dados comerciais", () => {
    const { custom } = splitCustomFieldsByGroup(fields);
    const plan = buildGroupSavePlan(10, custom, { 1: "ACME", 3: "" });
    expect(plan.upserts).toEqual([]);
    expect(plan.deleteFieldIds).toEqual([3, 5]);
  });
});
