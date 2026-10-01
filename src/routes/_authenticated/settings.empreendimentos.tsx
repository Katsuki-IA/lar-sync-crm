import { createFileRoute } from "@tanstack/react-router";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { NegotiationSettings } from "@/components/negotiation-settings";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/settings/empreendimentos")({
  component: NegotiationPage,
});

function NegotiationPage() {
  const { activeEmpresaId } = useActiveEmpresa();
  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-lg font-medium">Empresa e empreendimentos — venda e locação</h2>
      {activeEmpresaId ? (
        <NegotiationSettings key={activeEmpresaId} companyId={activeEmpresaId} />
      ) : (
        <p>Selecione uma empresa para configurar.</p>
      )}
    </Card>
  );
}
