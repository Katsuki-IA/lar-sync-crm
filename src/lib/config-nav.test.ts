import { describe, expect, it } from "vitest";
import { adminSidebarFor, configNavFor, isConfigItemActive, isConfigPath } from "./config-nav";

const both = { crm: true, atendimento_ia: true };

describe("sidebar Administração", () => {
  it("gestor com IA vê só Configurações e Integrações", () => {
    expect(adminSidebarFor("manager", both).map((i) => i.title)).toEqual(["Configurações", "Integrações"]);
  });
  it("gestor só CRM não vê Integrações", () => {
    expect(adminSidebarFor("manager", { crm: true, atendimento_ia: false }).map((i) => i.title)).toEqual(["Configurações"]);
  });
  it("super_admin vê só Configurações", () => {
    expect(adminSidebarFor("super_admin", both).map((i) => i.title)).toEqual(["Configurações"]);
  });
  it.each(["agent", "analyst", null])("%s não ganha acesso", (role) => {
    expect(adminSidebarFor(role, both)).toEqual([]);
    expect(configNavFor(role)).toEqual([]);
  });
});

describe("navegação de Configurações", () => {
  it("gestor só tem itens da empresa selecionada", () => {
    const nav = configNavFor("manager");
    expect(nav.every((i) => i.scope === "empresa")).toBe(true);
    expect(nav.map((i) => i.to)).toEqual(["/administracao", "/configuracoes", "/settings/users", "/settings/empreendimentos"]);
  });
  it("super_admin tem administração global, incluindo Empresas e módulos", () => {
    const global = configNavFor("super_admin").filter((i) => i.scope === "global").map((i) => i.to);
    expect(global).toContain("/modulos");
    expect(global).toContain("/admin/funnel");
    expect(global).toContain("/admin/tags");
  });
  it("cada destino aparece uma única vez", () => {
    const tos = configNavFor("super_admin").map((i) => i.to);
    expect(new Set(tos).size).toBe(tos.length);
  });
  it("Configuração dos módulos não fica ativa em Integrações", () => {
    const item = configNavFor("manager")[1];
    expect(isConfigItemActive(item, "/configuracoes")).toBe(true);
    expect(isConfigItemActive(item, "/configuracoes/integracoes")).toBe(false);
    expect(isConfigPath("/configuracoes/integracoes")).toBe(false);
    expect(isConfigPath("/admin/tags")).toBe(true);
    expect(isConfigPath("/settings/users")).toBe(true);
  });
});
