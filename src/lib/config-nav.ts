// Single source of truth for the Configurações navigation and the
// Administração sidebar entries. Pure so it can be tested per role/module.

export type ConfigScope = "empresa" | "global";
export type ConfigNavItem = { to: string; label: string; scope: ConfigScope; exact?: boolean };
type Modules = { crm?: boolean; atendimento_ia?: boolean } | null | undefined;

export const CONFIG_HOME = "/administracao";

export function canAccessConfig(role?: string | null) {
  return role === "manager" || role === "super_admin";
}

export function configNavFor(role?: string | null): ConfigNavItem[] {
  if (!canAccessConfig(role)) return [];
  const items: ConfigNavItem[] = [
    { to: "/administracao", label: "Empresa e empreendimentos", scope: "empresa" },
    { to: "/configuracoes", label: "Configuração dos módulos", scope: "empresa", exact: true },
    { to: "/settings/users", label: "Usuários e código de acesso", scope: "empresa" },
    { to: "/settings/empreendimentos", label: "Venda e locação", scope: "empresa" },
  ];
  if (role === "super_admin") {
    items.push(
      { to: "/modulos", label: "Empresas e módulos", scope: "global" },
      { to: "/admin/empresas", label: "Lista de empresas", scope: "global" },
      { to: "/admin/users", label: "Usuários (todas as empresas)", scope: "global" },
      { to: "/admin/funnel", label: "Etapas IA (padrão global)", scope: "global" },
      { to: "/admin/tags", label: "Tags (padrão global)", scope: "global" },
      { to: "/admin/custom-fields", label: "Campos do lead (padrão global)", scope: "global" },
      { to: "/admin/crm-dispatch", label: "Envio ao CRM", scope: "global" },
      { to: "/admin/site-forms", label: "Formulários externos", scope: "global" },
      { to: "/admin/reporting-api", label: "API de relatórios", scope: "global" },
      { to: "/admin/notifications", label: "Notificações", scope: "global" },
      { to: "/admin/paginas-legais", label: "Páginas legais", scope: "global" },
    );
  }
  return items;
}

export function isConfigItemActive(item: Pick<ConfigNavItem, "to" | "exact">, pathname: string) {
  const p = pathname.replace(/\/+$/, "") || "/";
  return item.exact ? p === item.to : p === item.to || p.startsWith(`${item.to}/`);
}

/** Any page that belongs to the Configurações area (integrations is separate). */
export function isConfigPath(pathname: string) {
  const p = pathname.replace(/\/+$/, "");
  if (p.startsWith("/configuracoes/integracoes")) return false;
  return ["/administracao", "/configuracoes", "/settings", "/modulos", "/admin"].some(
    (b) => p === b || p.startsWith(`${b}/`),
  );
}

export type AdminSidebarItem = { title: string; url: string; kind: "config" | "integrations" };

export function adminSidebarFor(role?: string | null, modules?: Modules): AdminSidebarItem[] {
  if (!canAccessConfig(role)) return [];
  const items: AdminSidebarItem[] = [{ title: "Configurações", url: CONFIG_HOME, kind: "config" }];
  // A página de integrações é por empresa e restrita ao gestor com Atendimento IA.
  if (role === "manager" && modules?.atendimento_ia) {
    items.push({ title: "Integrações", url: "/configuracoes/integracoes", kind: "integrations" });
  }
  return items;
}
