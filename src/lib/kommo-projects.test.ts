import { describe, expect, it } from "vitest";
import {
  KommoApi,
  kommoBaseUrl,
  findOption,
  selectProject,
  projectFieldValue,
  mayUpdateRemote,
  provision,
  type ProjectConfig,
  type KommoField,
} from "../../supabase/functions/_shared/kommo-projects";
const projects = [
  { id: 8, nome: "Eternity" },
  { id: 61, nome: "Piazza 685" },
];
const field: KommoField = {
  id: 100,
  name: "Empreendimento de interesse",
  type: "select",
  enums: [
    { id: 201, value: "Eternity" },
    { id: 202, value: "Piazza 685" },
    { id: 203, value: "Não definido" },
  ],
};
const config: ProjectConfig = {
  id_empresa: 9,
  enabled: true,
  account_url: "https://fixture.kommo.com",
  account_id: 1,
  field_id: 100,
  field_name: field.name,
  mappings: { "8": 201, "61": 202 },
  unknown_enum_id: 203,
  unknown_policy: "undefined",
  auto_create_options: true,
  sync_interest: true,
};
describe("Kommo project identification", () => {
  it("uses current interest and preserves tenant boundaries", () => {
    expect(selectProject(61, 8, projects)).toBe(61);
    expect(selectProject(null, 8, projects)).toBe(8);
    expect(selectProject(null, null, projects)).toBeNull();
    expect(() => selectProject(999, 8, projects)).toThrow("não pertence");
  });
  it("uses IDs and rejects missing mappings without guessing", () => {
    expect(projectFieldValue(config, 61)).toEqual({ field_id: 100, values: [{ enum_id: 202 }] });
    expect(projectFieldValue(config, null)?.values[0].enum_id).toBe(203);
    expect(() => projectFieldValue({ ...config, unknown_policy: "block" }, null)).toThrow(
      "pendente",
    );
    expect(() => projectFieldValue(config, 999)).toThrow("sem mapeamento");
    expect(projectFieldValue({ ...config, enabled: false }, 999)).toBeNull();
  });
  it("preserves manual edits and manual clearing, while backfilling blank fields", () => {
    expect(mayUpdateRemote(null, 201, null, false)).toBe("update");
    expect(mayUpdateRemote(202, 201, null, false)).toBe("conflict");
    expect(mayUpdateRemote(201, 202, 201, true)).toBe("update");
    expect(mayUpdateRemote(null, 202, 201, true)).toBe("conflict");
    expect(mayUpdateRemote(999, 202, 201, true)).toBe("conflict");
    expect(mayUpdateRemote(202, 202, 201, true)).toBe("unchanged");
  });
  it("only sends credentials to a Kommo account origin", () => {
    for (const url of [
      "http://fixture.kommo.com",
      "https://kommo.com.evil.test",
      "https://fixture.kommo.com@evil.test",
      "https://fixture.kommo.com/path",
      "https://fixture.kommo.com?redirect=1",
      "https://fixture.kommo.com:8443",
    ])
      expect(() => kommoBaseUrl(url)).toThrow();
    expect(kommoBaseUrl("https://fixture.kommo.com/")).toBe(config.account_url);
  });
  it("rejects ambiguous options", () => {
    expect(findOption(field, "  PIAZZA   685 ")).toBe(202);
    expect(() =>
      findOption(
        { ...field, enums: [...field.enums!, { id: 204, value: "eternity" }] },
        "Eternity",
      ),
    ).toThrow("duplicadas");
  });
  it("reuses existing IDs across project rename without recreating fields", async () => {
    const calls: string[] = [];
    const api = new KommoApi(config.account_url, "fixture", (async (url, init) => {
      calls.push(`${init?.method} ${url}`);
      return Response.json(String(url).endsWith("/account") ? { id: 1 } : field);
    }) as typeof fetch);
    const result = await provision(api, config, [
      { id: 8, nome: "Eternity novo nome" },
      projects[1],
    ]);
    expect(result.mappings).toEqual(config.mappings);
    expect(calls.every((c) => c.startsWith("GET"))).toBe(true);
  });
  it("appends options without deleting existing ones", async () => {
    let current = {
      ...field,
      enums: [field.enums![0], field.enums![2], { id: 999, value: "Outro projeto" }],
    };
    let patch: { enums: { id?: number; value: string }[] } | undefined;
    const api = new KommoApi(config.account_url, "fixture", (async (url, init) => {
      if (init?.method === "PATCH") {
        patch = JSON.parse(String(init.body));
        current = { ...current, enums: patch!.enums.map((e) => ({ ...e, id: e.id ?? 202 })) };
      }
      return Response.json(String(url).endsWith("/account") ? { id: 1 } : current);
    }) as typeof fetch);
    const result = await provision(api, { ...config, mappings: { "8": 201 } }, projects);
    expect(patch?.enums.map((e) => e.value)).toEqual([
      "Eternity",
      "Não definido",
      "Outro projeto",
      "Piazza 685",
    ]);
    expect(result.mappings["61"]).toBe(202);
  });
  it("rejects cross-account mapping and removed options", async () => {
    const api = new KommoApi(config.account_url, "fixture", (async (url) =>
      Response.json(String(url).endsWith("/account") ? { id: 2 } : field)) as typeof fetch);
    await expect(provision(api, config, projects)).rejects.toThrow("conta Kommo mudou");
    const api2 = new KommoApi(config.account_url, "fixture", (async (url) =>
      Response.json(String(url).endsWith("/account") ? { id: 1 } : field)) as typeof fetch);
    await expect(provision(api2, { ...config, mappings: { "8": 999 } }, projects)).rejects.toThrow(
      "removida",
    );
    await expect(
      provision(api2, { ...config, mappings: { "8": 201, "61": 201 } }, projects),
    ).rejects.toThrow("opção diferente");
  });
  it("recovers an already created standard field without creating a duplicate", async () => {
    const methods: string[] = [];
    const api = new KommoApi(config.account_url, "fixture", (async (url, init) => {
      methods.push(init!.method!);
      return Response.json(
        String(url).endsWith("/account") ? { id: 1 } : { _embedded: { custom_fields: [field] } },
      );
    }) as typeof fetch);
    const result = await provision(
      api,
      { ...config, field_id: null, mappings: {}, unknown_enum_id: null },
      projects,
      true,
    );
    expect(result.field_id).toBe(100);
    expect(methods).toEqual(["GET", "GET"]);
  });
  it("creates the standard field with all projects and the explicit unknown option", async () => {
    let created: unknown;
    const api = new KommoApi(config.account_url, "fixture", (async (url, init) => {
      if (String(url).endsWith("/account")) return Response.json({ id: 1 });
      if (init?.method === "POST") {
        created = JSON.parse(String(init.body));
        return Response.json({ _embedded: { custom_fields: [field] } });
      }
      return Response.json({ _embedded: { custom_fields: [] } });
    }) as typeof fetch);
    const result = await provision(
      api,
      { ...config, field_id: null, mappings: {}, unknown_enum_id: null },
      projects,
      true,
    );
    expect(created).toEqual([
      {
        name: field.name,
        type: "select",
        enums: [
          { value: "Eternity", sort: 0 },
          { value: "Piazza 685", sort: 1 },
          { value: "Não definido", sort: 2 },
        ],
      },
    ]);
    expect(result.mappings).toEqual(config.mappings);
  });
  it("does not create missing options when automatic creation is disabled", async () => {
    const api = new KommoApi(config.account_url, "fixture", (async (url, init) => {
      expect(init?.method).toBe("GET");
      return Response.json(
        String(url).endsWith("/account")
          ? { id: 1 }
          : { ...field, enums: [field.enums![0], field.enums![2]] },
      );
    }) as typeof fetch);
    await expect(
      provision(api, { ...config, mappings: { "8": 201 }, auto_create_options: false }, projects),
    ).rejects.toThrow("Faltam: Piazza 685");
  });
});
