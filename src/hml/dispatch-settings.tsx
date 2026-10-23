import { Link } from "@tanstack/react-router";
import { useCrmUser } from "@/hooks/use-crm-user";
import { buttonVariants } from "@/components/ui/button";

export function DispatchSettings({ companyId }: { companyId: number }) {
  const { data: me } = useCrmUser();
  return <section className="space-y-3 rounded-xl border p-4">
    <h2 className="font-semibold">Regras de envio ao CRM</h2>
    <p className="text-sm text-muted-foreground">
      As regras de qualificação, tempo de espera, continuidade do atendimento e filas
      são gerenciadas na configuração de envios do HUB.
    </p>
    {me?.role === "super_admin"
      ? <Link to="/admin/crm-dispatch" className={buttonVariants({ variant: "outline" })}>
          Abrir configuração de envios
        </Link>
      : <p className="text-sm">Solicite ao administrador Katsuki a alteração das regras da empresa #{companyId}.</p>}
  </section>;
}

