import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPasswordPolicyError, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { getRecoveryUserId, isVerifiedPasswordRecovery, subscribePasswordRecovery } from "@/lib/password-recovery";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Redefinir senha | Katsuki HUB — Homologação" },
    { name: "description", content: "Recuperação segura da senha de acesso ao Katsuki HUB — Homologação." },
    { property: "og:title", content: "Redefinir senha | Katsuki HUB — Homologação" },
    { property: "og:description", content: "Recuperação segura da senha de acesso ao Katsuki HUB — Homologação." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const recoveryUserId = useSyncExternalStore(subscribePasswordRecovery, getRecoveryUserId, () => null);
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const validRecovery = isVerifiedPasswordRecovery(recoveryUserId, verifiedUserId ?? undefined);

  useEffect(() => {
    let active = true;
    setChecking(true);
    setVerifiedUserId(null);
    // Defer Auth calls outside onAuthStateChange's lock. getUser also waits
    // for the SDK to finish processing the recovery return.
    const timer = setTimeout(() => {
      void supabase.auth.getUser().then(({ data, error }) => {
        if (!active) return;
        if (isVerifiedPasswordRecovery(recoveryUserId, data.user?.id, error)) {
          setVerifiedUserId(data.user?.id ?? null);
        }
        setChecking(false);
      }).catch(() => { if (active) setChecking(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [recoveryUserId]);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!validRecovery || loading) return;
    const policyError = getPasswordPolicyError(password);
    if (policyError) {
      toast.error(policyError);
      return;
    }
    if (password !== confirmPassword) {
      toast.error("As senhas não coincidem");
      return;
    }

    setLoading(true);
    try {
      const { data, error: sessionError } = await supabase.auth.getUser();
      if (!isVerifiedPasswordRecovery(getRecoveryUserId(), data.user?.id, sessionError)) {
        setVerifiedUserId(null);
        toast.error("Link de recuperação inválido ou expirado. Solicite outro na tela de login.");
        return;
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      setVerifiedUserId(null);
      await queryClient.cancelQueries();
      queryClient.clear();
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        // Still remove local credentials if the remote revocation failed.
        const { error: localError } = await supabase.auth.signOut({ scope: "local" });
        if (localError) throw localError;
      }
      toast.success("Senha redefinida com sucesso!", { description: "Faça login com sua nova senha." });
      await navigate({ to: "/auth", replace: true });
    } catch (error) {
      toast.error("Não foi possível concluir a redefinição", {
        description: error instanceof Error ? error.message : "Tente novamente ou solicite outro link.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md rounded-2xl shadow-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Redefinir senha</CardTitle>
          <CardDescription>
            {checking ? "Validando link de recuperação..." : validRecovery
              ? "Digite sua nova senha abaixo"
              : "Link de recuperação inválido ou expirado"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {checking ? <p role="status" className="text-center text-sm text-muted-foreground">Validando sessão...</p> : validRecovery ? (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Nova senha</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={PASSWORD_MIN_LENGTH}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={PASSWORD_MIN_LENGTH}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Use pelo menos 8 caracteres e um caractere especial, como !, @, # ou ?.
              </p>
              <Button type="submit" className="w-full rounded-xl" disabled={loading}>
                {loading ? "Redefinindo..." : "Redefinir senha"}
              </Button>
            </form>
          ) : (
            <div className="text-center space-y-4">
              <p className="text-muted-foreground text-sm">
                O link de recuperação é inválido ou expirou. Solicite um novo link na tela de login.
              </p>
              <Button
                variant="outline"
                className="w-full rounded-xl"
                onClick={() => navigate({ to: "/auth", replace: true })}
              >
                Voltar para o login
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

