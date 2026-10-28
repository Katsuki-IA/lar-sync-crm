import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useCrmUser } from "@/hooks/use-crm-user";
import { getTechnicalDocs } from "@/lib/technical-docs.functions";
import { TechnicalDocsContent } from "@/components/technical-docs";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/documentacao-tecnica")({
  component: TechnicalDocsPage,
});

function TechnicalDocsPage() {
  const { data: me, isPending: userPending } = useCrmUser();
  const load = useServerFn(getTechnicalDocs);
  const allowed = me?.role === "super_admin" && me.active === true;
  const query = useQuery({
    queryKey: ["technical-docs", me?.id],
    queryFn: () => load(),
    enabled: allowed,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  if (userPending) return <p role="status">Verificando acesso…</p>;
  if (!allowed)
    return <p role="alert">Esta página está disponível apenas para super admin ativo.</p>;
  if (query.isError)
    return (
      <div role="alert" className="space-y-3 rounded-xl border border-border p-6">
        <p>
          Não foi possível carregar a documentação. Verifique sua sessão e permissão de super admin.
        </p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  if (!query.data) return <p role="status">Carregando documentação técnica…</p>;
  return <TechnicalDocsContent docs={query.data} />;
}
