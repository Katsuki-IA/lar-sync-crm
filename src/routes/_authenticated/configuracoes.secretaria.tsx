import { createFileRoute } from "@tanstack/react-router";
import { ConfigHeader } from "@/components/config-presentation";
import { ConfigLayout } from "@/components/config-layout";
import { SecretarySettings } from "@/hml/secretary-settings";
import { Notice, useCompanyModules } from "@/hml/modules";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { useCrmUser } from "@/hooks/use-crm-user";
import { canAccessConfig } from "@/lib/config-nav";

export const Route = createFileRoute("/_authenticated/configuracoes/secretaria")({
  head: () => ({
    meta: [
      { title: "Secretária | Katsuki HUB" },
      { name: "description", content: "Conexão, automação e destinatários dos avisos da secretária." },
      { property: "og:title", content: "Secretária | Katsuki HUB" },
      { property: "og:description", content: "Conexão, automação e destinatários dos avisos da secretária." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { activeEmpresaId } = useActiveEmpresa();
  const { data: me } = useCrmUser();
  const modules = useCompanyModules();
  if (!me || (activeEmpresaId && modules.isPending))
    return <p className="text-sm">Carregando…</p>;
  if (!canAccessConfig(me.role))
    return (
      <Notice title="Acesso restrito">Área destinada à administração e aos gestores.</Notice>
    );
  if (!activeEmpresaId)
    return (
      <Notice title="Selecione uma empresa">Use o seletor no topo para começar.</Notice>
    );
  // Sem CRM habilitado a secretária não existe para a empresa: nenhuma consulta é feita.
  if (!modules.data?.crm)
    return (
      <Notice title="Módulo não habilitado para esta empresa">
        A secretária acompanha a distribuição de oportunidades do CRM comercial.
      </Notice>
    );
  return (
    <ConfigLayout>
      <div className="config-page space-y-6">
        <ConfigHeader title="Secretária" description="Conexão do WhatsApp, automação e WhatsApp dos corretores que recebem os avisos de ofertas da empresa selecionada." />
        <SecretarySettings
          key={activeEmpresaId}
          companyId={activeEmpresaId}
          isAdmin={me.role === "super_admin"}
        />
      </div>
    </ConfigLayout>
  );
}
