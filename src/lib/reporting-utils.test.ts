import { describe, expect, it } from "vitest";
import {
  chooseAttribution,
  cvIdFromResponse,
  normalizeReportPhone,
  reportPeriod,
  reportPersonKey,
  reportingQuerySchema,
} from "./reporting-utils";

describe("reporting data semantics", () => {
  it("keeps an existing Meta ad when a newer site capture has no attribution", () => {
    const meta = {
      source_type: "meta",
      meta_ad_id: "120246962959810218",
      meta_leadgen_id: "2299070707577611",
      created_at: "2026-09-15T06:13:48Z",
    };
    const site = {
      source_type: "site",
      meta_ad_id: null,
      meta_leadgen_id: null,
      created_at: "2026-09-16T10:00:00Z",
    };
    expect(chooseAttribution([site, meta])).toEqual(meta);
    expect(chooseAttribution([])).toBeNull();
  });
  it("extracts the CV ID from the response, never its success code", () => {
    expect(cvIdFromResponse({ dispatch: { codigo: 200, id: 11635 } })).toBe("11635");
    expect(cvIdFromResponse({ dispatch: { codigo: 200, sucesso: true } })).toBeNull();
    expect(cvIdFromResponse({ dispatch: { id: "garbage" } })).toBeNull();
  });
  it("normalizes formatting and country code without changing the ninth digit", async () => {
    expect(normalizeReportPhone("(41) 99918-3120")).toBe("5541999183120");
    expect(await reportPersonKey("(41) 99918-3120")).toBe(
      await reportPersonKey("+55 41 99918 3120"),
    );
    expect(await reportPersonKey("+55 41 9918 3120")).not.toBe(
      await reportPersonKey("+55 41 99918 3120"),
    );
    expect(await reportPersonKey(null)).toBeNull();
  });
  it("uses explicit inclusive calendar days with an exclusive upper bound", () => {
    expect(reportPeriod("2026-09-09", "2026-09-15", "America/Sao_Paulo")).toEqual({
      start: "2026-09-09T03:00:00.000Z",
      end: "2026-09-16T03:00:00.000Z",
    });
    expect(reportPeriod("2026-09-09", "2026-09-15", "UTC").end).toBe("2026-09-16T00:00:00.000Z");
    expect(() => reportPeriod("2026-02-30", "2026-03-01", "UTC")).toThrow();
    expect(() => reportPeriod("2026-09-15", "2026-09-09", "UTC")).toThrow();
  });
  it("rejects arbitrary parameters and unreasonable page sizes", () => {
    expect(
      reportingQuerySchema.safeParse({
        id_empresa: 25,
        data_inicio: "2026-09-09",
        data_fim: "2026-09-15",
        limite: 1000,
      }).success,
    ).toBe(false);
    expect(
      reportingQuerySchema.safeParse({
        id_empresa: 25,
        data_inicio: "2026-09-09",
        data_fim: "2026-09-15",
        token: "secret",
      }).success,
    ).toBe(false);
  });
});
