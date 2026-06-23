import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { data: me } = useCrmUser();
  const [currentPwd, setCurrentPwd] = useState("");
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPwd) return toast.error("Informe a senha atual");
    if (pwd.length < 6) return toast.error("A senha deve ter ao menos 6 caracteres");
    if (pwd !== confirm) return toast.error("As senhas não coincidem");
    if (currentPwd === pwd) return toast.error("A nova senha deve ser diferente da senha atual");
    if (!me?.email) return toast.error("Email do usuário não encontrado");

    try {
      setLoading(true);
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: me.email,
        password: currentPwd,
      });
      if (authError) {
        if (authError.code === "invalid_credentials") throw new Error("Senha atual incorreta");
        throw authError;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: pwd });
      if (updateError) throw updateError;

      setCurrentPwd("");
      setPwd("");
      setConfirm("");
      setShowCurrentPwd(false);
      setShowPwd(false);
      setShowConfirm(false);
      toast.success("Senha atualizada com sucesso");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar a senha");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Meu Perfil</h1>
        <p className="text-sm text-muted-foreground">Gerencie suas informações de conta</p>
      </div>

      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">Informações</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Field label="Nome" value={me?.nome ?? "—"} />
          <Field label="Email" value={me?.email ?? "—"} />
          <Field label="Função" value={getRoleLabel(me?.role)} />
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">Alterar senha</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <PasswordInput
              id="current-password"
              label="Senha atual"
              value={currentPwd}
              visible={showCurrentPwd}
              autoComplete="current-password"
              onChange={setCurrentPwd}
              onToggleVisibility={() => setShowCurrentPwd((current) => !current)}
            />
            <PasswordInput
              id="pwd"
              label="Nova senha"
              value={pwd}
              visible={showPwd}
              autoComplete="new-password"
              onChange={setPwd}
              onToggleVisibility={() => setShowPwd((current) => !current)}
            />
            <PasswordInput
              id="confirm"
              label="Confirmar nova senha"
              value={confirm}
              visible={showConfirm}
              autoComplete="new-password"
              onChange={setConfirm}
              onToggleVisibility={() => setShowConfirm((current) => !current)}
            />
            <Button type="submit" disabled={loading} className="rounded-xl">
              {loading ? "Salvando..." : "Atualizar senha"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function PasswordInput({
  id,
  label,
  value,
  visible,
  autoComplete,
  onChange,
  onToggleVisibility,
}: {
  id: string;
  label: string;
  value: string;
  visible: boolean;
  autoComplete: string;
  onChange: (value: string) => void;
  onToggleVisibility: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          className="pr-11"
        />
        <button
          type="button"
          className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onToggleVisibility}
          aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
          title={visible ? "Ocultar senha" : "Mostrar senha"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function getRoleLabel(role?: string | null) {
  if (role === "manager") return "Gestor";
  if (role === "agent") return "Corretor";
  if (role === "super_admin") return "Super Admin";
  return "—";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
