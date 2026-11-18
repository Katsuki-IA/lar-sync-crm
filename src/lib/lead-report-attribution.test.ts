import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { loadLeadReportAttribution, reportAttribution, reportCrmLeadId } from "./lead-report-attribution";

const attribution = (extra = {}) => ({
  crm_lead_id: 1, source_type: "meta", meta_form_id: null, meta_campaign_name: null,
  meta_adset_name: null, meta_ad_name: null, utm_source: null, utm_campaign: null,
  utm_adgroup: null, utm_ad: null, utm_content: null, raw_data: {}, ...extra,
});

describe("atribuição do relatório de leads", () => {
  it("formata origem e deixa ausências como travessão", () => {
    expect(reportAttribution()).toEqual({ origem: "—", fonte: "—", campanha: "—", conjunto: "—", anuncio: "—" });
    expect(reportAttribution("WA").origem).toBe("WA - Whatsapp");
  });
  it("identifica CTWA antes de formulário, e distingue formatos Meta", () => {
    expect(reportAttribution("WA", attribution({ raw_data: { capture_type: "ctwa" }, meta_form_id: "f" })).fonte).toBe("Click to WhatsApp");
    expect(reportAttribution("FB", attribution({ meta_form_id: "f" })).fonte).toBe("Meta Lead Ads");
    expect(reportAttribution("FB", attribution()).fonte).toBe("Meta Ads");
  });
  it("prioriza nomes Meta e usa todos os fallbacks UTM", () => {
    const utm = attribution({ source_type: "site", utm_source: "google", utm_campaign: "C", utm_adgroup: "G", utm_ad: "A", utm_content: "conteúdo" });
    expect(reportAttribution("SI", utm)).toMatchObject({ fonte: "google", campanha: "C", conjunto: "G", anuncio: "A" });
    expect(reportAttribution("SI", { ...utm, utm_ad: null }).anuncio).toBe("conteúdo");
    expect(reportAttribution("FB", { ...utm, meta_campaign_name: "MC", meta_adset_name: "MG", meta_ad_name: "MA" })).toMatchObject({ campanha: "MC", conjunto: "MG", anuncio: "MA" });
    expect(reportAttribution("SI", attribution({ source_type: "site" })).fonte).toBe("site");
  });
  it("não transforma ID externo inválido em vínculo CRM", () => {
    for (const id of [null, "", "abc", "0", "-1", "1.2", "9007199254740993"]) expect(reportCrmLeadId(id)).toBeNull();
    expect(reportCrmLeadId("123")).toBe(123);
  });
  it("consulta lotes e páginas com empresa e ordem determinística, sem perder a atribuição mais recente", async () => {
    const queries: Array<{ table: string; filters: unknown[]; orders: unknown[]; ids: number[]; range: number[] }> = [];
    const from = vi.fn((table: string) => {
      const query = { table, filters: [] as unknown[], orders: [] as unknown[], ids: [] as number[], range: [] as number[] };
      queries.push(query);
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => { query.filters.push([key, value]); return builder; },
        in: (_key: string, ids: number[]) => { query.ids = ids; return builder; },
        order: (key: string, options: unknown) => { query.orders.push([key, options]); return builder; },
        range: async (start: number, end: number) => {
          query.range = [start, end];
          const rows = table === "crm_leads" ? query.ids.map(id => ({ id, origem: "WA" }))
            : start === 0 && query.ids.includes(1)
              ? Array.from({ length: 1000 }, (_, index) => attribution({ crm_lead_id: index === 999 ? 999 : 1, meta_campaign_name: "recente" }))
              : start === 1000 ? [attribution({ meta_campaign_name: "antiga" }), attribution({ crm_lead_id: 2, meta_campaign_name: "página 2" })] : [];
          return { data: rows, error: null };
        },
      };
      return builder;
    });
    const result = await loadLeadReportAttribution({ from } as unknown as SupabaseClient<Database>, 38,
      [...Array.from({ length: 51 }, (_, i) => String(i + 1)), "1", "inválido", null]);
    expect(queries).toHaveLength(5);
    expect(queries.every(q => JSON.stringify(q.filters) === JSON.stringify([["id_empresa", 38]]))).toBe(true);
    expect(queries.every(q => q.ids.length <= 50)).toBe(true);
    expect(queries.filter(q => q.table === "crm_lead_attribution")[0].orders).toEqual([
      ["updated_at", { ascending: false }], ["created_at", { ascending: false }], ["id", { ascending: false }],
    ]);
    expect(queries.some(q => q.range[0] === 1000)).toBe(true);
    expect(result.get(1)?.campanha).toBe("recente");
    expect(result.get(2)?.campanha).toBe("página 2");
    expect(result.has(999)).toBe(false);
    expect(result.size).toBe(51);
  });
  it("não consulta sem vínculos e propaga falhas em vez de mascará-las", async () => {
    const from = vi.fn();
    await expect(loadLeadReportAttribution({ from } as unknown as SupabaseClient<Database>, 38, [null, "externo"])).resolves.toEqual(new Map());
    expect(from).not.toHaveBeenCalled();
    const builder = { select: () => builder, eq: () => builder, in: () => builder, order: () => builder,
      range: async () => ({ data: null, error: new Error("leitura indisponível") }) };
    await expect(loadLeadReportAttribution({ from: () => builder } as unknown as SupabaseClient<Database>, 38, ["1"])).rejects.toThrow("leitura indisponível");
  });
});