import { createFileRoute } from "@tanstack/react-router";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useCompanyModules } from "@/hml/modules";
import { ConfigLayout } from "@/components/config-layout";
import { CommercialSettings } from "@/hml/commercial-settings";
export const Route = createFileRoute("/_authenticated/configuracoes/comercial")({
  component: Page,
});
function Page() {
  const { activeEmpresaId } = useActiveEmpresa();
  const { data: me } = useCrmUser();
  const { data: modules } = useCompanyModules();
  return (
    <ConfigLayout>
      {activeEmpresaId &&
      modules?.crm &&
      ["manager", "gestor", "super_admin"].includes(me?.role ?? "") ? (
        <CommercialSettings key={activeEmpresaId} companyId={activeEmpresaId} />
      ) : (
        <p>Selecione uma empresa com CRM habilitado. A configuração é restrita ao gestor.</p>
      )}
    </ConfigLayout>
  );
}
