import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { hasAnyCrmUser } from "@/lib/setup.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import katsukiLogo from "@/assets/katsuki-logo.jpg.asset.json";


export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasUsers, setHasUsers] = useState(true);

  useEffect(() => {
    hasAnyCrmUser().then((res) => setHasUsers(res.hasUsers)).catch(() => setHasUsers(true));
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error("Falha ao entrar", { description: error.message });
      return;
    }
    toast.success("Bem-vindo de volta!");
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md rounded-2xl shadow-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 h-14 w-14 overflow-hidden rounded-2xl ring-1 ring-white/10 shadow-lg shadow-primary/30">
            <img src={katsukiLogo.url} alt="Katsuki" className="h-full w-full object-cover" />
          </div>
          <CardTitle className="text-2xl tracking-[0.2em]">KATSUKI</CardTitle>
          <CardDescription>Entre na sua conta para continuar</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full rounded-xl" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
          {!hasUsers && (
            <div className="mt-4 text-center">
              <button
                type="button"
                className="text-sm text-primary hover:underline"
                onClick={() => navigate({ to: "/setup" })}
              >
                Primeiro acesso? Criar conta administrador
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}