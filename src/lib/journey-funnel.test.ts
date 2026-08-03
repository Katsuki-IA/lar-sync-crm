import { describe, expect, it } from "vitest";
import {
  calculateJourneyFunnel,
  createJourneySessionIds,
} from "./journey-funnel";

describe("journey funnel", () => {
  it("creates both full and local phone session identifiers", () => {
    expect(createJourneySessionIds("+55 (48) 99999-0000", 9)).toEqual([
      "55489999900009",
      "489999900009",
    ]);
  });

  it("counts each cohort lead once according to the journey criteria", () => {
    const result = calculateJourneyFunnel({
      leads: [
        { id: 1, leadId: 101, telefones: ["+55 (48) 99999-0000"], idEmpresa: 9, leadQuente: true },
        { id: 2, leadId: 102, telefones: ["48988880000"], idEmpresa: 9, leadQuente: false },
        { id: 3, leadId: 103, telefones: ["48977770000"], idEmpresa: 9, leadQuente: true },
        { id: 4, leadId: null, telefones: ["48966660000"], idEmpresa: 9, leadQuente: false },
      ],
      messages: [
        { sessionId: "489999900009", type: "human" },
        { sessionId: "489999900009", type: "human" },
        { sessionId: "489888800009", type: "ai" },
        { sessionId: "489777700009", type: "human" },
      ],
      activities: [
        { leadId: 1, event: "external_crm_sent", descricao: null },
        { leadId: 1, event: "external_crm_sent", descricao: null },
        { leadId: 2, event: null, descricao: "Lead enviado ao CRM CV com sucesso" },
      ],
      appointments: [{ legacyLeadId: 101 }, { legacyLeadId: 101 }, { legacyLeadId: 102 }],
    });

    expect(result).toEqual({
      received: 4,
      engaged: 2,
      hot: 2,
      sentToCrm: 2,
      scheduled: 2,
    });
  });

  it("uses the linked legacy phone before the CRM fallback", () => {
    const result = calculateJourneyFunnel({
      leads: [
        {
          id: 1,
          leadId: 101,
          telefones: ["48999990000", "telefone-desatualizado"],
          idEmpresa: 9,
          leadQuente: false,
        },
      ],
      messages: [{ sessionId: "489999900009", type: "human" }],
      activities: [],
      appointments: [],
    });

    expect(result.engaged).toBe(1);
  });

  it("counts the legacy response classification when messages are unavailable", () => {
    const result = calculateJourneyFunnel({
      leads: [
        {
          id: 1,
          leadId: 101,
          telefones: ["48999990000"],
          idEmpresa: 9,
          leadQuente: false,
          legacyEngaged: true,
        },
      ],
      messages: [],
      activities: [],
      appointments: [],
    });

    expect(result.engaged).toBe(1);
  });
});
