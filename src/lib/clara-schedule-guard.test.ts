import { describe, expect, it } from "vitest";
import { resolveScheduleRequest, type Turn } from "./clara-schedule-guard.server";
import { createToolRunner, currentTimeNote } from "./clara-chat.server";

const NOW = "2026-11-19T16:00:00.000Z"; // 13h em São Paulo; amanhã = 20/11/2026
const at = (min: number) => new Date(Date.parse(NOW) - min * 60000).toISOString();
const ctx = (turns: Turn[]) => ({ recent_turns: turns, server_now: NOW, booking_rules: { tz: "America/Sao_Paulo", slot_minutes: 60 } });
const req = (msg: string, extra: Record<string, unknown> = {}) =>
  ({ empresa: 38, lead_id: 7, acao: "agendar", request: "r1", mensagem_atual: msg, data_raw: "2026-11-25", hora_raw: "15:00", ...extra });
const offer8e9: Turn = { type: "ai", text: "Tenho amanhã às 8h ou 9h. Qual prefere?", at: at(2) };

describe("guard de agenda", () => {
  it("escolha 10h após oferta amanhã 8h/9h usa o dia da oferta, não o do modelo", () => {
    const g = resolveScheduleRequest(req("10h"), ctx([offer8e9, { type: "human", text: "10h", at: at(1) }]));
    expect(g).toMatchObject({ valid: true, dia: "2026-11-20", hora: "10:00" });
  });
  it("'Sim' confirma proposta única", () => {
    const g = resolveScheduleRequest(req("Sim"), ctx([{ type: "ai", text: "Posso agendar amanhã às 9h? Confirma?", at: at(2) }, { type: "human", text: "Sim", at: at(1) }]));
    expect(g).toMatchObject({ valid: true, dia: "2026-11-20", hora: "09:00" });
  });
  it("'Sim' com duas opções é ambíguo", () => {
    const g = resolveScheduleRequest(req("Sim"), ctx([offer8e9, { type: "human", text: "Sim", at: at(1) }]));
    expect(g.valid).toBe(false);
  });
  it("e-mail depois da escolha retoma o horário escolhido", () => {
    const g = resolveScheduleRequest(req("ana@x.com"), ctx([
      offer8e9, { type: "human", text: "9h", at: at(2) },
      { type: "ai", text: "Qual seu e-mail para o convite da reunião?", at: at(1) }, { type: "human", text: "ana@x.com", at: at(0) },
    ]));
    expect(g).toMatchObject({ valid: true, dia: "2026-11-20", hora: "09:00" });
  });
  it("negação não agenda", () => {
    const g = resolveScheduleRequest(req("não, 9h não"), ctx([offer8e9, { type: "human", text: "não, 9h não", at: at(1) }]));
    expect(g.valid).toBe(false);
  });
  it("typo '15:h' vira 15:00", () => {
    const g = resolveScheduleRequest(req("15:h"), ctx([{ type: "ai", text: "Tenho amanhã às 14h ou 15h, qual prefere?", at: at(2) }, { type: "human", text: "15:h", at: at(1) }]));
    expect(g).toMatchObject({ valid: true, dia: "2026-11-20", hora: "15:00" });
  });
  it("sem evidência nas mensagens, dia/hora do modelo não reservam", () => {
    const g = resolveScheduleRequest(req("ok, quero a reunião"), ctx([{ type: "ai", text: "Prefere manhã ou tarde?", at: at(2) }]));
    expect(g.valid).toBe(false);
  });
});

describe("ferramenta agendar_reuniao", () => {
  const history = [
    { role: "assistant" as const, content: offer8e9.text, created_at: at(2) },
    { role: "user" as const, content: "10h", created_at: at(1) },
  ];
  const mk = (leadId: number | null) => {
    const calls: any[] = [];
    const run = createToolRunner({ admin: { rpc: async (fn: string, a: any) => { calls.push({ fn, a }); return { data: { outcome: "created" }, error: null }; } },
      tokenHash: "h", requestId: "r", leaseToken: "l", userTexts: ["10h"], history, leadId, clock: () => new Date(NOW) });
    return { run, calls };
  };
  it("valores do guard vencem os do modelo", async () => {
    const { run, calls } = mk(7);
    await run("agendar_reuniao", { acao: "agendar", dia: "2026-12-01", hora: "17:00", reserva_id: null, revisao: null });
    expect(calls[0].a).toMatchObject({ p_op: "agendar", p_day: "2026-11-20", p_time: "10:00" });
  });
  it("sem lead vinculado à sessão não chama o banco", async () => {
    const { run, calls } = mk(null);
    expect(await run("agendar_reuniao", { acao: "agendar", dia: "2026-11-20", hora: "10:00", reserva_id: null, revisao: null })).toMatchObject({ outcome: "contact_required" });
    expect(calls).toHaveLength(0);
  });
  it("hora atual de São Paulo entra no contexto", () => {
    expect(currentTimeNote(new Date(NOW))).toMatch(/19\/11\/2026.*13:00/);
  });
});
