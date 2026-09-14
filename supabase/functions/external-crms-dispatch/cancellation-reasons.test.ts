import { describe, expect, it } from "vitest";

import { selectCvCancellationReason } from "./cancellation-reasons";

const inocoopReasons = [
  { id: 11, nome: "Sem condições financeiras" },
  { id: 7, nome: "Não atende ligações, e-mail e WhatsApp" },
  { id: 14, nome: "Apenas curioso e pesquisando" },
  { id: 18, nome: "Crédito reprovado ou condicionado na analise de crédito" },
];

describe("selectCvCancellationReason", () => {
  it("selects the tenant-specific no-response reason without relying on its id", () => {
    const selection = selectCvCancellationReason({
      reasons: inocoopReasons,
      context: "Resumo menciona valor de entrada e financiamento.",
      reasonKind: "followup_no_response",
    });

    expect(selection.reason).toEqual({
      id: 7,
      nome: "Não atende ligações, e-mail e WhatsApp",
    });
  });

  it("does not treat a regular price or financing question as financial incapacity", () => {
    const selection = selectCvCancellationReason({
      reasons: inocoopReasons,
      context: "O lead perguntou o valor de entrada e como funciona o financiamento.",
    });

    expect(selection.reason.nome).toBe("Apenas curioso e pesquisando");
  });

  it("selects a financial reason only for an explicit financial objection", () => {
    const selection = selectCvCancellationReason({
      reasons: inocoopReasons,
      context: "O cliente disse que não tem condições financeiras e que a entrada é muito alta.",
    });

    expect(selection.reason.nome).toBe("Sem condições financeiras");
  });

  it("keeps an explicitly configured tenant reason as the highest priority", () => {
    const selection = selectCvCancellationReason({
      reasons: [...inocoopReasons, { id: 91, nome: "Descartado pela automação" }],
      context: "Lead não respondeu.",
      reasonKind: "followup_no_response",
      providedName: "Descartado pela automação",
    });

    expect(selection).toEqual({
      reason: { id: 91, nome: "Descartado pela automação" },
      source: "provided",
    });
  });

  it("supports another tenant using a different no-response label and id", () => {
    const selection = selectCvCancellationReason({
      reasons: [
        { id: "abc", nome: "Sem retorno após tentativas de contato" },
        { id: "def", nome: "Sem interesse" },
      ],
      context: "",
      reasonKind: "followup-no-response",
    });

    expect(selection.reason).toEqual({
      id: "abc",
      nome: "Sem retorno após tentativas de contato",
    });
  });
});
