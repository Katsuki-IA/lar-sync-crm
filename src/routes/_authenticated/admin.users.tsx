import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, KeyRound, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  createCrmUser,
  listAllCrmUsers,
  renameAiCrmUser,
  resetCrmUserPassword,
  setCrmUserActive,
  updateCrmUser,
} from "@/lib/admin.functions";
import { getPasswordPolicyError, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { supabase } from "@/integrations/supabase/client";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsersPage,
});

type AdminUserRow = {
  id: string;
  nome: string;
  email: string;
  role: "agent" | "manager" | "super_admin" | string;
  active: boolean | null;
  id_empresa: number | null;
  auth_user_id: string | null;
};

type EmpresaRow = {
  id: number;
  nome: string | null;
};

function emptyCreateForm() {
  return {
    nome: "",
    email: "",
    role: "agent" as "agent" | "manager" | "super_admin",
    password: "",
    id_empresa: "",
  };
}

function AdminUsersPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAllCrmUsers);
  const createFn = useServerFn(createCrmUser);
  const updateFn = useServerFn(updateCrmUser);
  const resetFn = useServerFn(resetCrmUserPassword);
  const toggleFn = useServerFn(setCrmUserActive);
  const renameAiFn = useServerFn(renameAiCrmUser);
  const { data: allowed } = useAllowedEmpresas();

  const [selectedEmpresa, setSelectedEmpresa] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [tempPwd, setTempPwd] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState(emptyCreateForm());
  const [editingUser, setEditingUser] = useState<AdminUserRow | null>(null);
  const [editForm, setEditForm] = useState({
    nome: "",
    email: "",
    role: "agent" as "agent" | "manager" | "super_admin",
    id_empresa: "",
  });
  const [editingAiUser, setEditingAiUser] = useState<AdminUserRow | null>(null);
  const [aiName, setAiName] = useState("");

  const { data: empresas = [] } = useQuery({
    enabled: !!allowed,
    queryKey: ["admin-users-empresas", allowed],
    queryFn: async (): Promise<EmpresaRow[]> => {
      const empresaIds = allowed ?? [];
      if (!empresaIds.length) return [];
      const { data, error } = await supabase
        .from("empresa_dados")
        .select("id,nome")
        .in("id", empresaIds)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ["admin_all_users"],
    queryFn: () => listFn(),
  });

  const empresaNameMap = useMemo(
    () =>
      new Map<number, string>(
        empresas.map((empresa) => [empresa.id, empresa.nome?.trim() || `Empresa ${empresa.id}`]),
      ),
    [empresas],
  );

  const filteredUsers = useMemo(() => {
    if (selectedEmpresa === "all") return data as AdminUserRow[];
    const empresaId = Number(selectedEmpresa);
    return (data as AdminUserRow[]).filter((user) => user.id_empresa === empresaId);
  }, [data, selectedEmpresa]);

  const createPasswordError = createForm.password ? getPasswordPolicyError(createForm.password) : null;

  const isAiUser = (user: AdminUserRow) =>
    !user.auth_user_id &&
    user.role === "agent" &&
    typeof user.email === "string" &&
    /^ia\+\d+@hub\.katsuki\.local$/i.test(user.email);

  const createMutation = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          nome: createForm.nome,
          email: createForm.email,
          role: createForm.role,
          password: createForm.password || undefined,
          id_empresa: createForm.role === "super_admin" ? undefined : Number(createForm.id_empresa),
        },
      }),
    onSuccess: async (result) => {
      toast.success("Usuário criado");
      setTempPwd(result.password);
      setCreateForm(emptyCreateForm());
      await qc.invalidateQueries({ queryKey: ["admin_all_users"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editingUser) return Promise.reject(new Error("Usuário não selecionado"));
      return updateFn({
        data: {
          user_id: editingUser.id,
          nome: editForm.nome,
          email: editForm.email,
          role: editForm.role,
          id_empresa: editForm.role === "super_admin" ? null : Number(editForm.id_empresa),
        },
      });
    },
    onSuccess: async () => {
      toast.success("Usuário atualizado");
      setEditOpen(false);
      setEditingUser(null);
      await qc.invalidateQueries({ queryKey: ["admin_all_users"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => toggleFn({ data: { user_id: id, active } }),
    onSuccess: async () => {
      toast.success("Status atualizado");
      await qc.invalidateQueries({ queryKey: ["admin_all_users"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) => resetFn({ data: { user_id: id } }),
    onSuccess: (result) => {
      setTempPwd(result.password);
      toast.success("Senha redefinida");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const renameAiMutation = useMutation({
    mutationFn: () => {
      if (!editingAiUser) return Promise.reject(new Error("Usuário não selecionado"));
      return renameAiFn({ data: { user_id: editingAiUser.id, nome: aiName.trim() } });
    },
    onSuccess: async () => {
      toast.success("Nome da atendente IA atualizado");
      setAiOpen(false);
      setEditingAiUser(null);
      setAiName("");
      await qc.invalidateQueries({ queryKey: ["admin_all_users"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">Usuários ({filteredUsers.length})</h2>
          <p className="text-sm text-muted-foreground">Crie, filtre e edite usuários das empresas do HUB.</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <Label>Empresa</Label>
            <Select value={selectedEmpresa} onValueChange={setSelectedEmpresa}>
              <SelectTrigger className="w-[240px] cursor-pointer">
                <SelectValue placeholder="Todas as empresas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as empresas</SelectItem>
                {empresas.map((empresa) => (
                  <SelectItem key={empresa.id} value={String(empresa.id)}>
                    {empresa.nome?.trim() || `Empresa ${empresa.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Dialog
            open={createOpen}
            onOpenChange={(open) => {
              setCreateOpen(open);
              if (!open) {
                setCreateForm(emptyCreateForm());
                setTempPwd(null);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button className="cursor-pointer">
                <Plus className="mr-2 h-4 w-4" />
                Novo usuário
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo usuário</DialogTitle>
              </DialogHeader>
              {tempPwd ? (
                <div className="space-y-3">
                  <p className="text-sm">Senha temporária gerada. Envie ao usuário, ela não será exibida novamente.</p>
                  <div className="flex items-center gap-2 rounded-lg bg-muted p-3 font-mono text-sm">
                    <span className="flex-1 break-all">{tempPwd}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="cursor-pointer"
                      onClick={() => {
                        navigator.clipboard.writeText(tempPwd);
                        toast.success("Copiado");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Nome</Label>
                    <Input value={createForm.nome} onChange={(event) => setCreateForm((prev) => ({ ...prev, nome: event.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={createForm.email}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, email: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Função</Label>
                    <Select
                      value={createForm.role}
                      onValueChange={(value) =>
                        setCreateForm((prev) => ({ ...prev, role: value as "agent" | "manager" | "super_admin" }))
                      }
                    >
                      <SelectTrigger className="cursor-pointer">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="agent">Corretor</SelectItem>
                        <SelectItem value="manager">Gestor</SelectItem>
                        <SelectItem value="super_admin">Super Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {createForm.role !== "super_admin" ? (
                    <div className="space-y-1.5">
                      <Label>Empresa</Label>
                      <Select
                        value={createForm.id_empresa}
                        onValueChange={(value) => setCreateForm((prev) => ({ ...prev, id_empresa: value }))}
                      >
                        <SelectTrigger className="cursor-pointer">
                          <SelectValue placeholder="Selecionar empresa" />
                        </SelectTrigger>
                        <SelectContent>
                          {empresas.map((empresa) => (
                            <SelectItem key={empresa.id} value={String(empresa.id)}>
                              {empresa.nome?.trim() || `Empresa ${empresa.id}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label>Senha temporária (opcional)</Label>
                    <Input
                      type="password"
                      minLength={PASSWORD_MIN_LENGTH}
                      placeholder="Deixe em branco para gerar"
                      value={createForm.password}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, password: event.target.value }))}
                    />
                    <p className={createPasswordError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                      {createPasswordError ??
                        "Se informada, use pelo menos 8 caracteres e um caractere especial. Em branco, uma senha segura será gerada."}
                    </p>
                  </div>
                </div>
              )}
              <DialogFooter>
                {tempPwd ? (
                  <Button
                    className="cursor-pointer"
                    onClick={() => {
                      setCreateOpen(false);
                      setTempPwd(null);
                    }}
                  >
                    Fechar
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" className="cursor-pointer" onClick={() => setCreateOpen(false)}>
                      Cancelar
                    </Button>
                    <Button
                      className="cursor-pointer"
                      onClick={() => createMutation.mutate()}
                      disabled={
                        !createForm.nome ||
                        !createForm.email ||
                        (createForm.role !== "super_admin" && !createForm.id_empresa) ||
                        !!createPasswordError ||
                        createMutation.isPending
                      }
                    >
                      Criar
                    </Button>
                  </>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando...</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Nome</th>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Empresa</th>
                <th className="px-4 py-2 text-left">Função</th>
                <th className="px-4 py-2 text-left">Ativo</th>
                <th className="px-4 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const aiUser = isAiUser(user);
                return (
                  <tr key={user.id} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">{user.nome}</td>
                    <td className="px-4 py-2 text-muted-foreground">{user.email}</td>
                    <td className="px-4 py-2">
                      {user.id_empresa != null ? (
                        <div className="flex flex-col">
                          <span>{empresaNameMap.get(user.id_empresa) ?? `Empresa ${user.id_empresa}`}</span>
                          <span className="text-xs text-muted-foreground">ID {user.id_empresa}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Global</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="secondary">
                        {user.role === "manager" ? "Gestor" : user.role === "super_admin" ? "Super Admin" : "Corretor"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <Switch
                        checked={!!user.active}
                        disabled={toggleMutation.isPending}
                        onCheckedChange={(value) => toggleMutation.mutate({ id: user.id, active: value })}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-2">
                        {aiUser ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="cursor-pointer"
                            onClick={() => {
                              setEditingAiUser(user);
                              setAiName(user.nome ?? "");
                              setAiOpen(true);
                            }}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Editar nome da IA
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="cursor-pointer"
                              onClick={() => {
                                setEditingUser(user);
                                setEditForm({
                                  nome: user.nome ?? "",
                                  email: user.email ?? "",
                                  role: (user.role === "manager" || user.role === "super_admin" ? user.role : "agent") as
                                    | "agent"
                                    | "manager"
                                    | "super_admin",
                                  id_empresa: user.id_empresa != null ? String(user.id_empresa) : "",
                                });
                                setEditOpen(true);
                              }}
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="cursor-pointer"
                              onClick={() => resetMutation.mutate(user.id)}
                            >
                              <KeyRound className="mr-2 h-4 w-4" />
                              Resetar senha
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditingUser(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={editForm.nome} onChange={(event) => setEditForm((prev) => ({ ...prev, nome: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(event) => setEditForm((prev) => ({ ...prev, email: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Função</Label>
              <Select
                value={editForm.role}
                onValueChange={(value) =>
                  setEditForm((prev) => ({ ...prev, role: value as "agent" | "manager" | "super_admin" }))
                }
              >
                <SelectTrigger className="cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">Corretor</SelectItem>
                  <SelectItem value="manager">Gestor</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editForm.role !== "super_admin" ? (
              <div className="space-y-1.5">
                <Label>Empresa</Label>
                <Select
                  value={editForm.id_empresa}
                  onValueChange={(value) => setEditForm((prev) => ({ ...prev, id_empresa: value }))}
                >
                  <SelectTrigger className="cursor-pointer">
                    <SelectValue placeholder="Selecionar empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {empresas.map((empresa) => (
                      <SelectItem key={empresa.id} value={String(empresa.id)}>
                        {empresa.nome?.trim() || `Empresa ${empresa.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button
              className="cursor-pointer"
              onClick={() => updateMutation.mutate()}
              disabled={
                !editForm.nome ||
                !editForm.email ||
                (editForm.role !== "super_admin" && !editForm.id_empresa) ||
                updateMutation.isPending
              }
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={aiOpen}
        onOpenChange={(open) => {
          setAiOpen(open);
          if (!open) {
            setEditingAiUser(null);
            setAiName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear atendente IA</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ai-user-name">Nome exibido no histórico</Label>
              <Input
                id="ai-user-name"
                value={aiName}
                onChange={(event) => setAiName(event.target.value)}
                placeholder="Ex.: Clara"
              />
            </div>
            {editingAiUser ? (
              <p className="text-sm text-muted-foreground">
                {editingAiUser.id_empresa != null
                  ? `${empresaNameMap.get(editingAiUser.id_empresa) ?? `Empresa ${editingAiUser.id_empresa}`} · ${editingAiUser.email}`
                  : editingAiUser.email}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setAiOpen(false)}>
              Cancelar
            </Button>
            <Button
              className="cursor-pointer"
              onClick={() => renameAiMutation.mutate()}
              disabled={!aiName.trim() || renameAiMutation.isPending}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
