import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Facebook, Plug, RefreshCw, Unplug } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/configuracoes/integracoes")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: me } = await supabase
      .from("crm_users")
      .select("role")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();
    if (!me || (me.role !== "manager" && me.role !== "super_admin")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: IntegracoesPage,
});

type MetaConnection = {
  id: string;
  user_name: string | null;
  user_id_meta: string;
  connected_at: string | null;
  active: boolean | null;
};

type MetaForm = {
  id: string;
  form_id: string;
  form_name: string | null;
  page_id: string;
  page_name: string | null;
};

function IntegracoesPage() {
  const { data: me } = useCrmUser();
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: connection, isLoading } = useQuery({
    enabled: !!me?.id_empresa,
    queryKey: ["meta-connection", me?.id_empresa],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_meta_connections")
        .select("id,user_name,user_id_meta,connected_at,active")
        .eq("id_empresa", me!.id_empresa as number)
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      return (data as MetaConnection | null) ?? null;
    },
  });

  const { data: forms = [] } = useQuery({
    enabled: !!connection?.id,
    queryKey: ["meta-forms", connection?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_meta_forms")
        .select("id,form_id,form_name,page_id,page_name")
        .eq("connection_id", connection!.id)
        .order("page_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MetaForm[];
    },
  });

  const connected = !!connection;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="text-sm text-muted-foreground">
          Conecte fontes externas de leads ao seu CRM
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card
          className="p-5"
          style={{ backgroundColor: "#13151F", borderColor: "#2A2D3A" }}
        >
          <div className="flex items-start gap-4">
            <div
              className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: "rgba(24,119,242,0.12)" }}
            >
              <Facebook className="h-6 w-6" style={{ color: "#1877F2" }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-foreground">
                  Meta Ads — Lead Ads
                </h3>
                {isLoading ? (
                  <Badge variant="secondary" className="text-[10px]">…</Badge>
                ) : connected ? (
                  <Badge
                    className="text-[10px] border-0"
                    style={{ backgroundColor: "rgba(34,197,94,0.15)", color: "#22c55e" }}
                  >
                    Conectado
                  </Badge>
                ) : (
                  <Badge
                    className="text-[10px] border-0"
                    style={{ backgroundColor: "rgba(148,163,184,0.15)", color: "#94a3b8" }}
                  >
                    Não conectado
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Receba leads automaticamente dos seus formulários do Facebook e Instagram
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {connected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDrawerOpen(true)}
                  >
                    Gerenciar
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="gap-2"
                    style={{ backgroundColor: "#1877F2", color: "#fff" }}
                    onClick={() =>
                      toast("Em breve: autenticação com o Meta será configurada")
                    }
                  >
                    <Facebook className="h-4 w-4" />
                    Conectar com Facebook
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          className="w-full sm:max-w-md flex flex-col"
          style={{ backgroundColor: "#13151F", borderColor: "#2A2D3A" }}
        >
          <SheetHeader>
            <SheetTitle>Conexão Meta Ads</SheetTitle>
            <SheetDescription>
              Detalhes da conta conectada e formulários sincronizados.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto mt-4 space-y-5">
            <div className="rounded-lg border p-4" style={{ borderColor: "#2A2D3A" }}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Conta Meta
              </div>
              <div className="mt-1 text-sm font-medium text-foreground">
                {connection?.user_name ?? "Conta sem nome"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                ID: {connection?.user_id_meta}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Formulários sincronizados ({forms.length})
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => toast("Sincronização será ativada em breve")}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Sincronizar
                </Button>
              </div>
              {forms.length === 0 ? (
                <div
                  className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
                  style={{ borderColor: "#2A2D3A" }}
                >
                  Nenhum formulário sincronizado ainda.
                </div>
              ) : (
                <div className="space-y-2">
                  {forms.map((f) => (
                    <div
                      key={f.id}
                      className="rounded-lg border p-3"
                      style={{ borderColor: "#2A2D3A" }}
                    >
                      <div className="text-sm font-medium text-foreground truncate">
                        {f.form_name ?? f.form_id}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {f.page_name ?? f.page_id}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 border-t" style={{ borderColor: "#2A2D3A" }}>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="w-full gap-2">
                  <Unplug className="h-4 w-4" />
                  Desconectar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Desconectar Meta Ads?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Você deixará de receber leads dos formulários do Facebook e Instagram.
                    Esta ação pode ser revertida reconectando a conta.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      if (!connection?.id) return;
                      const { error } = await supabase
                        .from("crm_meta_connections")
                        .update({ active: false })
                        .eq("id", connection.id);
                      if (error) {
                        toast.error(error.message);
                        return;
                      }
                      toast.success("Conta Meta desconectada");
                      setDrawerOpen(false);
                      qc.invalidateQueries({ queryKey: ["meta-connection"] });
                    }}
                  >
                    Desconectar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SheetContent>
      </Sheet>

      {/* Hidden icon to keep import used in design phase */}
      <Plug className="hidden" />
    </div>
  );
}