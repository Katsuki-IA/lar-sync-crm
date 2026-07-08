import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { listAllCrmUsers, renameAiCrmUser } from "@/lib/admin.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const qc = useQueryClient();
  const fn = useServerFn(listAllCrmUsers);
  const renameFn = useServerFn(renameAiCrmUser);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [newName, setNewName] = useState("");
  const { data = [], isLoading } = useQuery({
    queryKey: ["admin_all_users"],
    queryFn: () => fn(),
  });

  const renameMutation = useMutation({
    mutationFn: async () => {
      if (!editingUser) return;
      return renameFn({ data: { user_id: editingUser.id, nome: newName.trim() } });
    },
    onSuccess: async () => {
      toast.success("Nome da atendente IA atualizado");
      setEditingUser(null);
      setNewName("");
      await qc.invalidateQueries({ queryKey: ["admin_all_users"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const isAiUser = (user: any) =>
    !user.auth_user_id &&
    user.role === "agent" &&
    typeof user.email === "string" &&
    /^ia\+\d+@hub\.katsuki\.local$/i.test(user.email);

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
                <th className="text-right px-4 py-2">Ações</th>
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
                    {u.active ? <Badge style={{ background: "var(--success)", color: "#fff" }} className="border-0">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {isAiUser(u) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="cursor-pointer"
                        onClick={() => {
                          setEditingUser(u);
                          setNewName(u.nome ?? "");
                        }}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Editar nome da IA
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={!!editingUser} onOpenChange={(open) => {
        if (!open) {
          setEditingUser(null);
          setNewName("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear atendente IA</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ai-user-name">Nome exibido no histórico</Label>
              <Input
                id="ai-user-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Ex.: Clara"
              />
            </div>
            {editingUser ? (
              <p className="text-sm text-muted-foreground">
                Empresa #{editingUser.id_empresa} · {editingUser.email}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditingUser(null);
                setNewName("");
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => renameMutation.mutate()}
              disabled={!newName.trim() || renameMutation.isPending}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
