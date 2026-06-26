import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  ExternalLink,
  Plug,
  RefreshCw,
  Save,
  Settings,
  Unplug,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createExternalCrmRdOAuthUrl,
  disconnectExternalCrm,
  getExternalCrmRdFunnels,
  getExternalCrmsStatus,
  saveExternalCrmSettings,
  type ExternalCrmProvider,
} from "@/lib/external-crms.functions";

export const Route = createFileRoute("/_authenticated/settings/external-crms")({
  component: ExternalCrmsPage,
});

type RdOAuthCallbackMessage = {
  source?: string;
  ok?: boolean;
  error?: string | null;
};

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function providerDescription(provider: ExternalCrmProvider) {
  switch (provider.provider) {
    case "rd_station":
      return "Envie leads selecionados do HUB para o RD Station CRM.";
    case "cv_crm":
      return "Envio de leads para o CV CRM.";
    case "c2s":
      return "Envio de leads para o C2S.";
    case "kommo":
      return "Envio de leads para o Kommo.";
    case "loft":
      return "Envio de leads para o Loft.";
    default:
      return "Conector para API personalizada.";
  }
}

function providerIcon(provider: ExternalCrmProvider) {
  if (provider.provider === "rd_station") return <Webhook className="h-6 w-6 text-red-500" />;
  return <Plug className="h-6 w-6 text-primary" />;
}

function ExternalCrmsPage() {
  const qc = useQueryClient();
  const [rdDialogOpen, setRdDialogOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [rdFunnelId, setRdFunnelId] = useState("");
  const [rdFunnelName, setRdFunnelName] = useState("");
  const [rdStageId, setRdStageId] = useState("");
  const [rdStageName, setRdStageName] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["external-crms-status"],
    queryFn: getExternalCrmsStatus,
  });

  const rdProvider = useMemo(
    () => data?.providers.find((item) => item.provider === "rd_station") ?? null,
    [data?.providers],
  );
  const rdConnection = rdProvider?.connection ?? null;
  const rdConnected = Boolean(rdConnection?.active);
  const rdFunnelsQuery = useQuery({
    queryKey: ["external-crms-rd-funnels", rdConnection?.id],
    queryFn: getExternalCrmRdFunnels,
    enabled: rdDialogOpen && rdConnected,
  });
  const rdFunnels = rdFunnelsQuery.data?.funnels ?? [];
  const selectedRdFunnel = rdFunnels.find((funnel) => funnel.id === rdFunnelId) ?? null;
  const selectedRdStage =
    selectedRdFunnel?.stages.find((stage) => stage.id === rdStageId) ??
    selectedRdFunnel?.stages[0] ??
    null;

  useEffect(() => {
    if (!rdDialogOpen || !rdConnection?.settings) return;
    setRdFunnelId(rdConnection.settings.rd_funnel_id ?? "");
    setRdFunnelName(rdConnection.settings.rd_funnel_name ?? "");
    setRdStageId(rdConnection.settings.rd_stage_id ?? "");
    setRdStageName(rdConnection.settings.rd_stage_name ?? "");
  }, [rdConnection?.settings, rdDialogOpen]);

  useEffect(() => {
    if (!rdDialogOpen || !rdFunnels.length) return;

    const current = rdFunnels.find((funnel) => funnel.id === rdFunnelId);
    const funnel = current ?? rdFunnels[0];
    const stage = current?.stages.find((item) => item.id === rdStageId) ?? funnel.stages[0] ?? null;

    if (!current) {
      setRdFunnelId(funnel.id);
      setRdFunnelName(funnel.name);
    } else {
      setRdFunnelName(current.name);
    }

    setRdStageId(stage?.id ?? "");
    setRdStageName(stage?.name ?? "");
  }, [rdDialogOpen, rdFunnels, rdFunnelId, rdStageId]);

  function handleRdFunnelChange(funnelId: string) {
    const funnel = rdFunnels.find((item) => item.id === funnelId);
    if (!funnel) return;
    const stage = funnel.stages[0] ?? null;
    setRdFunnelId(funnel.id);
    setRdFunnelName(funnel.name);
    setRdStageId(stage?.id ?? "");
    setRdStageName(stage?.name ?? "");
  }

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      const message = event.data as RdOAuthCallbackMessage | undefined;
      if (message?.source !== "external-crm-rd-oauth" || event.origin !== window.location.origin) return;
      setConnecting(false);
      if (message.ok) {
        await qc.invalidateQueries({ queryKey: ["external-crms-status"] });
        await qc.invalidateQueries({ queryKey: ["external-crms-rd-funnels"] });
        setRdDialogOpen(true);
        toast.success("RD Station CRM conectado");
      } else {
        toast.error(message.error ?? "Falha ao conectar RD Station CRM");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [qc]);

  async function startRdOAuth() {
    const width = 560;
    const height = 720;
    const popup = window.open(
      "",
      "external-crm-rd-oauth",
      `popup=yes,width=${width},height=${height},left=${window.screenX + Math.max(0, (window.outerWidth - width) / 2)},top=${window.screenY + Math.max(0, (window.outerHeight - height) / 2)},resizable=yes,scrollbars=yes,status=no,toolbar=no,menubar=no,location=no`,
    );
    if (!popup) {
      toast.error("Permita popups para conectar com o RD Station");
      return;
    }

    try {
      setConnecting(true);
      const { url } = await createExternalCrmRdOAuthUrl();
      popup.location.href = url;
      popup.focus();
    } catch (error) {
      popup.close();
      setConnecting(false);
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar conexão RD");
    }
  }

  async function saveRdDestination() {
    try {
      setSaving(true);
      await saveExternalCrmSettings({
        provider: "rd_station",
        rdFunnelId,
        rdFunnelName,
        rdStageId,
        rdStageName,
      });
      await qc.invalidateQueries({ queryKey: ["external-crms-status"] });
      await qc.invalidateQueries({ queryKey: ["external-crms-rd-funnels"] });
      toast.success("Destino RD Station salvo");
      setRdDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar destino RD");
    } finally {
      setSaving(false);
    }
  }

  async function disconnectRd() {
    try {
      setDisconnecting(true);
      await disconnectExternalCrm("rd_station");
      await qc.invalidateQueries({ queryKey: ["external-crms-status"] });
      setRdDialogOpen(false);
      toast.success("RD Station CRM desconectado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao desconectar RD");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">CRMs externos</h2>
        <p className="text-sm text-muted-foreground">
          Configure os destinos para enviar leads do HUB para o CRM principal da empresa.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(data?.providers ?? []).map((provider) => {
          const connected = Boolean(provider.connection?.active);
          const configured = Boolean(
            provider.provider === "rd_station" &&
              (provider.connection?.settings?.rd_funnel_id || provider.connection?.settings?.rd_funnel_name),
          );
          return (
            <Card key={provider.provider} className="p-5">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  {providerIcon(provider)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold">{provider.label}</h3>
                    <Badge variant={connected ? "secondary" : "outline"}>
                      {isLoading ? "…" : connected ? "Conectado" : "Não conectado"}
                    </Badge>
                    {!provider.available ? <Badge variant="outline">Em preparação</Badge> : null}
                    {connected && configured ? (
                      <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                        <CheckCircle2 className="h-3 w-3" /> Configurado
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{providerDescription(provider)}</p>
                  {provider.connection?.last_error ? (
                    <p className="mt-2 flex gap-1 text-xs text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {provider.connection.last_error}
                    </p>
                  ) : null}
                  {connected ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Conectado em {formatDate(provider.connection?.connected_at)}
                      {provider.provider === "rd_station" && provider.connection?.settings?.rd_funnel_name
                        ? ` · funil ${provider.connection.settings.rd_funnel_name}`
                        : ""}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {provider.provider === "rd_station" ? (
                      <>
                        {connected ? (
                          <Button variant="outline" size="sm" className="gap-2" onClick={() => setRdDialogOpen(true)}>
                            <Settings className="h-4 w-4" />
                            Configurar
                          </Button>
                        ) : (
                          <Button size="sm" className="gap-2" disabled={connecting} onClick={startRdOAuth}>
                            <Plug className="h-4 w-4" />
                            {connecting ? "Conectando..." : "Conectar RD"}
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button variant="outline" size="sm" className="gap-2" disabled>
                        <CircleSlash className="h-4 w-4" />
                        Indisponível
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={rdDialogOpen} onOpenChange={setRdDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Destino RD Station CRM</DialogTitle>
            <DialogDescription>
              Configure o funil do RD que receberá os leads enviados pelo HUB. Essa configuração é
              separada da captação de leads por LPs e formulários RD.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {rdFunnelsQuery.isLoading ? (
              <div className="flex items-center gap-2 rounded-md border border-border p-3 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Buscando funis e etapas no RD Station...
              </div>
            ) : null}

            {rdFunnelsQuery.data?.warning && !rdFunnels.length ? (
              <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                <p>{rdFunnelsQuery.data.warning}</p>
                {rdFunnelsQuery.data.details?.length ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-medium">Ver diagnóstico técnico</summary>
                    <ul className="mt-2 space-y-1">
                      {rdFunnelsQuery.data.details.map((detail) => (
                        <li key={detail} className="break-words rounded border border-amber-200 bg-white/60 px-2 py-1">
                          {detail}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2 bg-transparent"
                    onClick={() => void rdFunnelsQuery.refetch()}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Tentar novamente
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2 bg-transparent"
                    onClick={() => {
                      setRdFunnelId("");
                      setRdFunnelName("Funil padrão do RD");
                      setRdStageId("");
                      setRdStageName("Etapa inicial padrão do RD");
                    }}
                  >
                    Usar funil padrão do RD
                  </Button>
                </div>
              </div>
            ) : null}

            {!rdFunnels.length && rdFunnelName ? (
              <div className="rounded-md border border-input bg-muted/30 p-3 text-sm">
                <div className="font-medium">{rdFunnelName}</div>
                <div className="text-muted-foreground">{rdStageName || "Etapa inicial padrão do RD"}</div>
              </div>
            ) : null}

            {rdFunnelsQuery.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                Não foi possível buscar os funis do RD Station. Verifique a conexão e tente novamente.
              </div>
            ) : null}

            {rdFunnels.length ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="rd-funnel-select">Funil no RD</Label>
                  <Select value={rdFunnelId} onValueChange={handleRdFunnelChange}>
                    <SelectTrigger id="rd-funnel-select" className="cursor-pointer">
                      <SelectValue placeholder="Selecione o funil" />
                    </SelectTrigger>
                    <SelectContent>
                      {rdFunnels.map((funnel) => (
                        <SelectItem key={funnel.id} value={funnel.id} className="cursor-pointer">
                          {funnel.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Etapa inicial</Label>
                  <div className="rounded-md border border-input bg-muted/30 px-3 py-2 text-sm">
                    {selectedRdStage?.name ?? "Etapa inicial padrão do RD"}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    O HUB envia para a primeira etapa retornada pelo RD para esse funil.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter className="sm:justify-between gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="gap-2 text-destructive" disabled={!rdConnected}>
                  <Unplug className="h-4 w-4" />
                  Desconectar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Desconectar RD Station CRM?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O destino deixará de receber envios de leads. O histórico de envios será preservado.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void disconnectRd()} disabled={disconnecting}>
                    {disconnecting ? "Desconectando..." : "Desconectar"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <div className="flex gap-2">
              <Button variant="outline" className="gap-2" asChild>
                <a href="https://developers.rdstation.com/" target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Docs RD
                </a>
              </Button>
              <Button onClick={saveRdDestination} disabled={saving || (!rdFunnelId && !rdFunnelName) || rdFunnelsQuery.isLoading}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Salvando..." : "Salvar destino"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
