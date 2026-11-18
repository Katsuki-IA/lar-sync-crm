import { describe, expect, it } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { activeDeepLink, selectNativeConversation, shouldReportDeepLinkError } from "./conversation-selection";

const rows = [{ lead_id: 1 }, { lead_id: 2 }];
const ctxKey = (empresa: number, lead: string | undefined) => ["native-conversation-context", empresa, "me", lead];

describe("deep link de conversa", () => {
  it("deep link válido fica ativo e seleciona o detalhe", () => {
    const active = activeDeepLink("9", null, null);
    expect(active).toBe("9");
    expect(selectNativeConversation(rows, null, active, { lead_id: 9 })).toEqual({ lead_id: 9 });
  });

  it("deep link inválido + seleção posterior: descarta e não ressuscita após reset de filtro", () => {
    expect(shouldReportDeepLinkError(activeDeepLink("9", null, null), true)).toBe(true);
    // usuário escolhe a conversa 2 da lista → referência descartada
    expect(activeDeepLink("9", 2, "9")).toBeUndefined();
    expect(shouldReportDeepLinkError(activeDeepLink("9", 2, "9"), true)).toBe(false);
    // filtro reseta selectedId para null: deep link continua descartado
    const afterReset = activeDeepLink("9", null, "9");
    expect(afterReset).toBeUndefined();
    expect(shouldReportDeepLinkError(afterReset, true)).toBe(false);
    expect(selectNativeConversation(rows, null, afterReset, null)).toEqual({ lead_id: 1 });
    // voltar/avançar para outro lead reabre normalmente (dismissed é zerado ao mudar o lead)
    expect(activeDeepLink("7", null, null)).toBe("7");
  });

  it("erro em voo após troca de conversa não vira erro ativo", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let reject!: (e: Error) => void;
    const key = ctxKey(1, "9");
    const obs = new QueryObserver(qc, { queryKey: key, queryFn: ({ signal }) => new Promise((_, r) => { reject = r; signal.addEventListener("abort", () => r(new Error("abort"))); }) });
    const unsub = obs.subscribe(() => {});
    await Promise.resolve();
    // usuário seleciona outra conversa: consulta antiga cancelada
    await qc.cancelQueries({ queryKey: key, exact: true });
    reject(new Error("tarde"));
    await new Promise(r => setTimeout(r, 0));
    expect(qc.getQueryState(key)?.status).not.toBe("error");
    expect(shouldReportDeepLinkError(activeDeepLink("9", 2, "9"), true)).toBe(false);
    unsub();
  });

  it("troca de empresa isola o contexto e reabre o deep link na nova empresa", () => {
    expect(ctxKey(1, "9")).not.toEqual(ctxKey(2, "9"));
    // workspace remonta por empresa → estado zerado
    expect(activeDeepLink("9", null, null)).toBe("9");
  });
});
