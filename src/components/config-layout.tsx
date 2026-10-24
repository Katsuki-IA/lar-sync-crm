import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { configNavFor, isConfigItemActive, type ConfigScope } from "@/lib/config-nav";

const scopeLabel: Record<ConfigScope, string> = {
  empresa: "Empresa selecionada",
  global: "Administração global",
};

/** Navegação interna única da área Configurações; envolve as telas existentes. */
export function ConfigLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: me } = useCrmUser();
  const { activeEmpresa } = useActiveEmpresa();
  const items = configNavFor(me?.role);
  if (!items.length) return <>{children}</>;
  const current = items.find((i) => isConfigItemActive(i, pathname));
  const groups = (["empresa", "global"] as ConfigScope[])
    .map((scope) => ({ scope, items: items.filter((i) => i.scope === scope) }))
    .filter((g) => g.items.length);

  return (
    <div className="space-y-5">
      <nav aria-label="Trilha" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <span>Configurações</span>
        {current && (
          <>
            <ChevronRight className="h-3 w-3" />
            <span>
              {scopeLabel[current.scope]}
              {current.scope === "empresa" && activeEmpresa?.nome ? ` · ${activeEmpresa.nome}` : ""}
            </span>
            <ChevronRight className="h-3 w-3" />
            <span aria-current="page" className="font-medium text-foreground">{current.label}</span>
          </>
        )}
      </nav>
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav aria-label="Seções de configurações" className="shrink-0 lg:w-60">
          <div className="flex gap-4 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {groups.map((g) => (
              <div key={g.scope} className="min-w-max lg:min-w-0">
                <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {scopeLabel[g.scope]}
                </div>
                <div className="flex gap-1 lg:flex-col">
                  {g.items.map((item) => {
                    const active = isConfigItemActive(item, pathname);
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors lg:whitespace-normal",
                          active
                            ? "bg-accent font-medium text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
