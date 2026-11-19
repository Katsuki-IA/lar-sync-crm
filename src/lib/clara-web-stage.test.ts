import { describe, expect, it, vi } from "vitest";
import { CLARA_GREETING } from "./clara-chat";
import { createToolRunner, generateClaraReply } from "./clara-chat.server";
import { webBookingAccepted } from "./clara-web-stage";
const user = (content: string) => ({ role: "user" as const, content });
const ai = (content: string) => ({ role: "assistant" as const, content });
const invite = ai("Quer marcar uma reunião para ver como a IA atenderia seu pet shop?");

describe("consentimento exclusivo do chat web", () => {
  it("reprodução do print: nome e telefone não são aceite", () => {
    expect(webBookingAccepted([ai(CLARA_GREETING), user("me chamo André"), ai("Qual seu telefone? Depois mostro horários para reunião."), user("41996159088")])).toBe(false);
  });
  it.each(["Sim", "André", "41996159088", "Quero conhecer a IA", "Como posso agendar uma reunião?", "Meu cliente quer agendar uma reunião", "Quero agendar banho e tosa"])("não confunde resposta ou explicação: %s", (text) => {
    expect(webBookingAccepted([ai(CLARA_GREETING), user(text)])).toBe(false);
  });
  it("sim responde somente à última pergunta", () => {
    expect(webBookingAccepted([ai("Quer marcar uma reunião? Qual seu telefone?"), user("sim")])).toBe(false);
    expect(webBookingAccepted([ai("Você já usa CRM?"), user("sim")])).toBe(false);
    expect(webBookingAccepted([invite, user("sim")])).toBe(true);
  });
  it.each(["Quero agendar uma reunião", "Podemos marcar?", "Gostaria de agendar"])("pedido direto: %s", (text) => {
    expect(webBookingAccepted([user(text)])).toBe(true);
  });
  it("preserva aceite durante coleta de contato e escolha de horário, mas respeita recusa", () => {
    const accepted = [invite, user("sim"), ai("Qual seu telefone?"), user("41996159088"), ai("Prefere amanhã de manhã ou de tarde?"), user("tarde")];
    expect(webBookingAccepted(accepted)).toBe(true);
    expect(webBookingAccepted([...accepted, user("Não quero mais a reunião")])).toBe(false);
    expect(webBookingAccepted([invite, user("Talvez depois")])).toBe(false);
  });
  it("mesmo que IA tente, cadastro não libera RPC de horários/reserva", async () => {
    const rpc = vi.fn(async () => ({ data: { outcome: "saved", lead_id: 7 }, error: null }));
    const history = [ai(CLARA_GREETING), user("me chamo André"), ai("Qual telefone?"), user("41996159088")];
    const run = createToolRunner({ admin: { rpc }, history, userTexts: history.filter(x=>x.role==='user').map(x=>x.content), tokenHash:"h", requestId:"r", leaseToken:"l" });
    await run("registrar_contato", {nome:"André",telefone:"41996159088",email:null});
    expect(await run("consultar_horarios", {dia:null,periodo:null})).toMatchObject({outcome:"meeting_consent_required"});
    expect(await run("agendar_reuniao", {acao:"agendar"})).toMatchObject({outcome:"meeting_consent_required"});
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("não oferece ferramentas de agenda antes do aceite; libera depois", async () => {
    for (const [history, expected] of [[ [ai(CLARA_GREETING),user("André")], false ], [[invite,user("sim")],true]] as const) {
      const transport = vi.fn(async (body: any) => {
        expect(body.tools.some((t:any)=>t.function.name==='consultar_horarios')).toBe(expected);
        expect(body.messages.at(-1).content).toContain("Etapa do chat web:");
        return {choices:[{message:{content:"resposta"}}]};
      });
      await generateClaraReply({ system:"s",history:[...history],greeting:false,model:"gpt-4.1",temperature:0.5,transport,runTool:async()=>({}) });
    }
  });
});
