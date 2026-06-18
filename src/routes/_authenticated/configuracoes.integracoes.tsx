import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Facebook, Plug, RefreshCw, Unplug } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  createMetaOAuthUrl,
  disconnectMetaConnection,
  getMetaIntegrationStatus,
  syncMetaForms,
} from "@/lib/meta-oauth.functions";
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
  leads_count: number | null;
  active: boolean | null;
};

function IntegracoesPage() {
  const qc = useQueryClient();
  const createOAuthUrl = useServerFn(createMetaOAuthUrl);
  const getStatus = useServerFn(getMetaIntegrationStatus);
  const syncForms = useServerFn(syncMetaForms);
  const disconnectConnection = useServerFn(disconnectMetaConnection);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const msg = ev.data as { source?: string; ok?: boolean; error?: string } | undefined;
      if (!msg || msg.source !== "meta-oauth") return;
      setConnecting(false);
      if (msg.ok) {
        toast.success("Conta Meta conectada com sucesso");
        qc.invalidateQueries({ queryKey: ["meta-integration-status"] });
      } else {
        toast.error(msg.error ?? "Falha ao conectar com o Meta");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [qc]);

  const startMetaOAuth = async () => {
    try {
      setConnecting(true);
      const { url } = await createOAuthUrl();
      const w = 600;
      const h = 720;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      const popup = window.open(
        url,
        "meta-oauth",
        `width=${w},height=${h},left=${left},top=${top}`,
      );
      if (!popup) {
        toast.error("Permita popups para conectar com o Facebook");
        setConnecting(false);
      }
    } catch (error) {
      setConnecting(false);
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar conexão Meta");
    }
  };

  const { data: status, isLoading } = useQuery({
    queryKey: ["meta-integration-status"],
    queryFn: async () => {
      return getStatus();
    },
  });

  const connection = (status?.connection as MetaConnection | null | undefined) ?? null;
  const forms = (status?.forms as MetaForm[] | undefined) ?? [];

  const connected = !!connection;

  const handleSyncForms = async () => {
    try {
      setSyncing(true);
      const result = await syncForms();
      toast.success(`${result.formsCount} formulário(s) sincronizado(s)`);
      await qc.invalidateQueries({ queryKey: ["meta-integration-status"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao sincronizar formulários");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="text-sm text-muted-foreground">Conecte fontes externas de leads ao seu CRM</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5" style={{ backgroundColor: "#13151F", borderColor: "#2A2D3A" }}>
          <div className="flex items-start gap-4">
            <div
              className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: "rgba(24,119,242,0.12)" }}
            >
              <Facebook className="h-6 w-6" style={{ color: "#1877F2" }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-foreground">Meta Ads — Lead Ads</h3>
                {isLoading ? (
                  <Badge variant="secondary" className="text-[10px]">
                    …
                  </Badge>
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
                  <Button variant="outline" size="sm" onClick={() => setDrawerOpen(true)}>
                    Gerenciar
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="gap-2"
                    disabled={connecting}
                    style={{ backgroundColor: "#1877F2", color: "#fff" }}
                    onClick={startMetaOAuth}
                  >
                    <Facebook className="h-4 w-4" />
                    {connecting ? "Aguardando..." : "Conectar com Facebook"}
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
                  disabled={syncing}
                  onClick={handleSyncForms}
                >
                  <RefreshCw className={syncing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                  {syncing ? "Sincronizando" : "Sincronizar"}
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
                        {typeof f.leads_count === "number" ? ` · ${f.leads_count} leads` : ""}
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
                    Você deixará de receber leads dos formulários do Facebook e Instagram. Esta ação
                    pode ser revertida reconectando a conta.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      try {
                        await disconnectConnection();
                        toast.success("Conta Meta desconectada");
                        setDrawerOpen(false);
                        qc.invalidateQueries({ queryKey: ["meta-integration-status"] });
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Falha ao desconectar",
                        );
                      }
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
