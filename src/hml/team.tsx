import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";
export type TeamMember = {
  id: string; nome: string; email: string; role: string; active: boolean;
  team_revision: number; auth_user_id: string | null;
};
export function TeamPanel({ companyId, members, isAdmin }: {
  companyId: number; members: TeamMember[]; isAdmin: boolean;
}) {
  return <section className="space-y-4">
    <h2 className="font-semibold">Equipe da empresa</h2>
    <p className="text-sm text-muted-foreground">Cadastro, acesso e recuperação de senha são gerenciados na área de usuários.</p>
    {isAdmin && <Link className={buttonVariants({ variant: "outline" })} to="/settings/users">Gerenciar usuários</Link>}
    <ul className="divide-y" aria-label={`Equipe da empresa ${companyId}`}>
      {members.map(member => <li key={member.id} className="py-3">
        <strong>{member.nome}</strong><span className="ml-2 text-sm">{member.active ? "Ativo" : "Suspenso"}</span>
        <p className="text-sm text-muted-foreground">{member.email}</p>
      </li>)}
    </ul>
    {!members.length && <p className="text-sm">Nenhum usuário cadastrado nesta empresa.</p>}
  </section>;
}

