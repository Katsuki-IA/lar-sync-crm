import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, KeyRound, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { createCrmUser, resetCrmUserPassword, setCrmUserActive } from "@/lib/admin.functions";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getPasswordPolicyError, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

export const Route = createFileRoute("/_authenticated/settings/users")({
  component: UsersPage,
});

type Row = { id: string; nome: string; email: string; role: string; active: boolean | null };

function UsersPage() {
  const qc = useQueryClient();
  const { data: me } = useCrmUser();
  const { data: allowed } = useAllowedEmpresas();
  const createFn = useServerFn(createCrmUser);
  const resetFn = useServerFn(resetCrmUserPassword);
  const toggleFn = useServerFn(setCrmUserActive);
  const isSuperAdmin = me?.role === "super_admin";

  const { data: empresas = [] } = useQuery({
    enabled: isSuperAdmin && !!allowed,
    queryKey: ["empresas-katsuki", allowed],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresa_dados")
        .select("id,nome")
        .in("id", allowed ?? [])
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["crm_users_list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_users")
        .select("id,nome,email,role,active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Row[];
    },
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    email: "",
    role: "agent" as "agent" | "manager" | "super_admin",
    password: "",
    id_empresa: "",
  });
  const [tempPwd, setTempPwd] = useState<string | null>(null);
  const customPasswordError = form.password ? getPasswordPolicyError(form.password) : null;

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          nome: form.nome,
          email: form.email,
          role: form.role,
          password: form.password || undefined,
          id_empresa: form.id_empresa ? Number(form.id_empresa) : undefined,
        },
      }),
    onSuccess: (r) => {
      toast.success("Usuário criado");
      setTempPwd(r.password);
      setForm({ nome: "", email: "", role: "agent", password: "", id_empresa: "" });
      qc.invalidateQueries({ queryKey: ["crm_users_list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reset = useMutation({
    mutationFn: (id: string) => resetFn({ data: { user_id: id } }),
    onSuccess: (r) => {
      setTempPwd(r.password);
      toast.success("Senha redefinida");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => toggleFn({ data: { user_id: id, active } }),
    onSuccess: () => {
      toast.success("Atualizado");
      qc.invalidateQueries({ queryKey: ["crm_users_list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Usuários</h2>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTempPwd(null); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Novo usuário</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
            {tempPwd ? (
              <div className="space-y-3">
                <p className="text-sm">Senha temporária gerada. Envie ao usuário — não será mostrada novamente:</p>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted font-mono text-sm">
                  <span className="flex-1 break-all">{tempPwd}</span>
                  <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(tempPwd); toast.success("Copiado"); }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2"><Label>Nome</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="space-y-2">
                  <Label>Função</Label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as "agent" | "manager" | "super_admin" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agent">Corretor</SelectItem>
                      <SelectItem value="manager">Gestor</SelectItem>
                      {isSuperAdmin && <SelectItem value="super_admin">Super Admin</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                {isSuperAdmin && form.role !== "super_admin" && (
                  <div className="space-y-2">
                    <Label>Empresa</Label>
                    <Select value={form.id_empresa} onValueChange={(v) => setForm({ ...form, id_empresa: v })}>
                      <SelectTrigger><SelectValue placeholder="Selecionar empresa" /></SelectTrigger>
                      <SelectContent>
                        {empresas.map((e) => (
                          <SelectItem key={e.id} value={String(e.id)}>{e.nome ?? `Empresa ${e.id}`}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Senha temporária (opcional)</Label>
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Deixe em branco para gerar"
                    minLength={PASSWORD_MIN_LENGTH}
                    aria-describedby="temporary-password-help"
                  />
                  <p
                    id="temporary-password-help"
                    className={customPasswordError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
                  >
                    {customPasswordError ??
                      "Se informada, use pelo menos 8 caracteres e um caractere especial. Em branco, uma senha segura será gerada."}
                  </p>
                </div>
              </div>
            )}
            <DialogFooter>
              {tempPwd ? (
                <Button onClick={() => { setOpen(false); setTempPwd(null); }}>Fechar</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                  <Button
                    onClick={() => create.mutate()}
                    disabled={
                      !form.nome ||
                      !form.email ||
                      (isSuperAdmin && form.role !== "super_admin" && !form.id_empresa) ||
                      !!customPasswordError ||
                      create.isPending
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

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Nome</th>
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Função</th>
                <th className="text-left px-4 py-2">Ativo</th>
                <th className="text-right px-4 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">{u.nome}</td>
                  <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-2"><Badge variant="secondary">{u.role === "manager" ? "Gestor" : u.role === "super_admin" ? "Super Admin" : "Corretor"}</Badge></td>
                  <td className="px-4 py-2">
                    <Switch checked={!!u.active} onCheckedChange={(v) => toggle.mutate({ id: u.id, active: v })} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => reset.mutate(u.id)}>
                      <KeyRound className="h-4 w-4 mr-1" />Resetar senha
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tempPwd && !open && (
        <div className="p-3 rounded-lg bg-muted flex items-center gap-2">
          <span className="text-sm">Nova senha:</span>
          <code className="flex-1 font-mono text-sm">{tempPwd}</code>
          <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(tempPwd); toast.success("Copiado"); }}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setTempPwd(null)}>OK</Button>
        </div>
      )}
    </Card>
  );
}
