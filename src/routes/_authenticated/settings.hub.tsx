import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy, Link2 } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";

export const Route = createFileRoute("/_authenticated/settings/hub")({
  component: HubSettingsPage,
});

type EmpresaHubCode = {
  id: number;
  nome: string;
  codigo_hub: string | null;
};

function HubSettingsPage() {
  const { data: allowed } = useAllowedEmpresas();

  const { data, isLoading } = useQuery({
    enabled: !!allowed,
    queryKey: ["settings-hub-code", allowed],
    queryFn: async (): Promise<EmpresaHubCode[]> => {
      const empresaIds = allowed ?? [];
      if (!empresaIds.length) return [];

      const { data: rows, error } = await supabase
        .from("empresa_dados")
        .select("id,nome,codigo_hub")
        .in("id", empresaIds)
        .order("nome", { ascending: true });

      if (error) throw error;
      return (rows ?? []) as EmpresaHubCode[];
    },
  });

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code);
    toast.success("Código copiado");
  }

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-medium">Código de acesso</h2>
        <p className="text-sm text-muted-foreground">
          Compartilhe este código apenas com colaboradores autorizados a visualizar históricos individuais de leads.
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando...</div>
      ) : !data?.length ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          Nenhuma empresa encontrada.
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((empresa) => (
            <div
              key={empresa.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-background p-4"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Link2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-foreground">{empresa.nome}</div>
                  <div className="text-sm text-muted-foreground">Código do HUB Katsuki</div>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                <span className="font-mono text-2xl font-bold tracking-wide text-foreground">
                  {empresa.codigo_hub ?? "----"}
                </span>
                <span className="text-sm text-muted-foreground">Código do HUB</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={!empresa.codigo_hub}
                  onClick={() => empresa.codigo_hub && copyCode(empresa.codigo_hub)}
                  title="Copiar código"
                  aria-label="Copiar código"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
