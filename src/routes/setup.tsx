import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { firstSetup } from "@/lib/setup.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPasswordPolicyError, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

export const Route = createFileRoute("/setup")({
  ssr: false,
  beforeLoad: async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const policyError = password ? getPasswordPolicyError(password) : null;
    if (policyError) return toast.error(policyError);
    setLoading(true);
    try {
      const payload: { nome: string; email: string; password?: string } = {
        nome,
        email,
      };
      if (password.trim()) payload.password = password.trim();

      const result = await firstSetup({ data: payload });
      if (result.ok) {
        toast.success("Conta criada com sucesso!");
        if (result.password && !password.trim()) {
          setGeneratedPassword(result.password);
        } else {
          navigate({ to: "/auth" });
        }
      }
    } catch (err: any) {
      toast.error("Erro", { description: err?.message ?? "Falha ao criar conta" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md rounded-2xl shadow-sm">
        <CardHeader className="text-center">
          <img
            src="/katsuki-logo.svg"
            alt="Katsuki"
            className="mx-auto mb-4 object-contain"
            style={{ height: 110, width: "auto" }}
          />
          <CardTitle className="text-2xl">Primeiro Acesso</CardTitle>
          <CardDescription>
            Crie a conta do super administrador para começar a usar o Katsuki
          </CardDescription>
        </CardHeader>
        <CardContent>
          {generatedPassword ? (
            <div className="space-y-4">
              <div
                className="rounded-xl border p-4"
                style={{ backgroundColor: "var(--success-bg)", borderColor: "var(--success)" }}
              >
                <p className="text-sm font-medium" style={{ color: "var(--success)" }}>
                  Conta criada! Anote a senha temporária abaixo. Ela não será mostrada novamente.
                </p>
                <div className="mt-2 rounded-lg bg-background p-3 text-center font-mono text-lg tracking-wide">
                  {generatedPassword}
                </div>
              </div>
              <Button className="w-full rounded-xl" onClick={() => navigate({ to: "/auth" })}>
                Ir para o login
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nome">Nome completo</Label>
                <Input
                  id="nome"
                  type="text"
                  required
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="João Silva"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="joao@empresa.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha (opcional)</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Deixe em branco para gerar automática"
                  minLength={PASSWORD_MIN_LENGTH}
                />
                <p className="text-xs text-muted-foreground">
                  Se informada, use pelo menos 8 caracteres e um caractere especial. Em branco, uma senha segura será gerada.
                </p>
              </div>
              <Button type="submit" className="w-full rounded-xl" disabled={loading}>
                {loading ? "Criando conta..." : "Criar conta e entrar"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Já tem uma conta?{" "}
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => navigate({ to: "/auth" })}
                >
                  Faça login
                </button>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
