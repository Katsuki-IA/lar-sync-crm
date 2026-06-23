import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPasswordPolicyError, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [hashType, setHashType] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace("#", ""));
    setHashType(params.get("type"));
  }, []);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
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
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      toast.error("Erro ao redefinir senha", { description: error.message });
      return;
    }

    toast.success("Senha redefinida com sucesso!", {
      description: "Faça login com sua nova senha.",
    });

    // Limpar hash da URL
    window.location.hash = "";
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md rounded-2xl shadow-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Redefinir senha</CardTitle>
          <CardDescription>
            {hashType === "recovery"
              ? "Digite sua nova senha abaixo"
              : "Link de recuperação inválido ou expirado"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hashType === "recovery" ? (
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
                onClick={() => (window.location.href = "/auth")}
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
