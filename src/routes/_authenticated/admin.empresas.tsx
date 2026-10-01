import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEmpresas } from "@/lib/admin.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { NegotiationSettings } from "@/components/negotiation-settings";

export const Route = createFileRoute("/_authenticated/admin/empresas")({
  component: EmpresasPage,
});

function EmpresasPage() {
  const [selectedCompany, setSelectedCompany] = useState<number | null>(null);
  const fn = useServerFn(listEmpresas);
  const { data = [], isLoading } = useQuery({
    queryKey: ["admin_empresas"],
    queryFn: () => fn(),
  });

  return (
    <Card className="p-4">
      <h2 className="text-lg font-medium mb-4">Empresas ({data.length})</h2>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">ID</th>
                <th className="text-left px-4 py-2">Nome</th>
                <th className="text-left px-4 py-2">Usuários</th>
                <th className="text-left px-4 py-2">Criada em</th>
                <th className="text-left px-4 py-2">Negociação</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs">{e.id}</td>
                  <td className="px-4 py-2 font-medium">{e.nome ?? "—"}</td>
                  <td className="px-4 py-2">
                    <Badge variant="secondary">{e.total_usuarios}</Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {e.created_at ? new Date(e.created_at).toLocaleDateString("pt-BR") : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <Button variant="outline" size="sm" onClick={() => setSelectedCompany(e.id)}>
                      Configurar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={selectedCompany !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedCompany(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Venda e locação</DialogTitle>
            <DialogDescription>Modalidades da empresa e dos empreendimentos.</DialogDescription>
          </DialogHeader>
          {selectedCompany !== null && (
            <NegotiationSettings key={selectedCompany} companyId={selectedCompany} />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
