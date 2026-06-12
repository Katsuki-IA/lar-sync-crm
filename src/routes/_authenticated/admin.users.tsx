import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAllCrmUsers } from "@/lib/admin.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const fn = useServerFn(listAllCrmUsers);
  const { data = [], isLoading } = useQuery({
    queryKey: ["admin_all_users"],
    queryFn: () => fn(),
  });

  return (
    <Card className="p-4">
      <h2 className="text-lg font-medium mb-4">Usuários ({data.length})</h2>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Nome</th>
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Empresa</th>
                <th className="text-left px-4 py-2">Função</th>
                <th className="text-left px-4 py-2">Ativo</th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">{u.nome}</td>
                  <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-2 font-mono text-xs">{u.id_empresa ?? "—"}</td>
                  <td className="px-4 py-2">
                    <Badge variant="secondary">
                      {u.role === "manager" ? "Gestor" : u.role === "super_admin" ? "Super Admin" : "Corretor"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">
                    {u.active ? <Badge style={{ background: "#22C55E", color: "#fff" }} className="border-0">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}