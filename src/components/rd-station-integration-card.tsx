import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Settings, Unplug, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createRdOAuthUrl,
  disconnectRdConnection,
  getRdIntegrationStatus,
  saveRdSettings,
} from "@/lib/rd-oauth.functions";

type RdOAuthCallbackMessage = {
  source?: string;
  ok?: boolean;
  code?: string | null;
  state?: string | null;
  error?: string | null;
  errorDescription?: string | null;
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

export function RdStationIntegrationCard() {
  const qc = useQueryClient();
  const [connectOpen, setConnectOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [empreendimentoId, setEmpreendimentoId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["rd-integration-status"],
    queryFn: getRdIntegrationStatus,
  });
  const connected = Boolean(data?.connection?.active);

  useEffect(() => {
    if (!empreendimentoId && data?.empreendimentos.length === 1) {
      setEmpreendimentoId(String(data.empreendimentos[0].id));
    }
  }, [data?.empreendimentos, empreendimentoId]);

  useEffect(() => {
    if (manageOpen && data?.connection?.default_id_empreendimento) {
      setEmpreendimentoId(String(data.connection.default_id_empreendimento));
    }
  }, [data?.connection?.default_id_empreendimento, manageOpen]);

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      const message = event.data as RdOAuthCallbackMessage | undefined;
      if (message?.source !== "rd-oauth" || event.origin !== window.location.origin) return;
      setConnecting(false);
      if (message.ok) {
        await qc.invalidateQueries({ queryKey: ["rd-integration-status"] });
        setConnectOpen(false);
        toast.success("Conta RD Station conectada");
      } else {
        toast.error(message.errorDescription ?? message.error ?? "Falha ao conectar RD Station");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [qc]);

  async function startOAuth() {
    const selectedId = Number(empreendimentoId);
    if (!selectedId) {
      toast.error("Selecione o empreendimento padrão");
      return;
    }
    const width = 560;
    const height = 720;
    const popup = window.open(
      "",
      "rd-oauth",
      `popup=yes,width=${width},height=${height},left=${window.screenX + Math.max(0, (window.outerWidth - width) / 2)},top=${window.screenY + Math.max(0, (window.outerHeight - height) / 2)},resizable=yes,scrollbars=yes,status=no,toolbar=no,menubar=no,location=no`,
    );
    if (!popup) {
      toast.error("Permita popups para conectar com o RD Station");
      return;
    }
    try {
      setConnecting(true);
      const { url } = await createRdOAuthUrl(selectedId);
      popup.location.href = url;
      popup.focus();
    } catch (error) {
      popup.close();
      setConnecting(false);
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar conexão RD");
    }
  }

  async function saveSettings() {
    const selectedId = Number(empreendimentoId);
    if (!selectedId) return;
    try {
      setSaving(true);
      await saveRdSettings(selectedId);
      await qc.invalidateQueries({ queryKey: ["rd-integration-status"] });
      setManageOpen(false);
      toast.success("Configuração do RD Station atualizada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar configuração");
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    try {
      setDisconnecting(true);
      const result = await disconnectRdConnection();
      await qc.invalidateQueries({ queryKey: ["rd-integration-status"] });
      setManageOpen(false);
      if (result.warning) {
        toast.warning("Conexão desativada", { description: result.warning });
      } else {
        toast.success("RD Station desconectado");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao desconectar RD Station");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <>
      <Card className="p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0 bg-red-50">
            <Webhook className="h-6 w-6 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-foreground">RD Station Marketing</h3>
              <Badge
                className="text-[10px] border-0"
                style={{
                  backgroundColor: connected ? "var(--success-bg)" : "var(--surface-2)",
                  color: connected ? "var(--success)" : "var(--text-muted)",
                }}
              >
                {isLoading ? "…" : connected ? "Conectado" : "Não conectado"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Receba automaticamente as conversões dos formulários e landing pages do RD
            </p>
            {connected ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {data?.summary.processed ?? 0} lead(s) processado(s) · último evento {formatDate(data?.connection?.last_event_at ?? null)}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {connected ? (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setManageOpen(true)}>
                  <Settings className="h-4 w-4" />
                  Acessar
                </Button>
              ) : (
                <Button size="sm" className="gap-2 bg-red-500 text-white hover:bg-red-600" onClick={() => setConnectOpen(true)}>
                  <Webhook className="h-4 w-4" />
                  Conectar RD Station
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar RD Station Marketing</DialogTitle>
            <DialogDescription>
              Escolha onde os novos leads serão cadastrados. A conta RD será autorizada na etapa seguinte.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Empreendimento padrão</Label>
            <Select value={empreendimentoId} onValueChange={setEmpreendimentoId}>
              <SelectTrigger><SelectValue placeholder="Selecionar empreendimento" /></SelectTrigger>
              <SelectContent>
                {data?.empreendimentos.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>{item.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectOpen(false)}>Cancelar</Button>
            <Button onClick={startOAuth} disabled={connecting || !empreendimentoId}>
              {connecting ? "Aguardando autorização..." : "Continuar com RD Station"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conexão RD Station</DialogTitle>
            <DialogDescription>
              Conta {data?.connection?.platform_account_id ?? "conectada"} · desde {formatDate(data?.connection?.connected_at ?? null)}
            </DialogDescription>
          </DialogHeader>

          {data?.connection?.last_error ? (
            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{data.connection.last_error}</span>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>Empreendimento padrão</Label>
            <Select value={empreendimentoId} onValueChange={setEmpreendimentoId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {data?.empreendimentos.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>{item.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              ["Recebidos", data?.summary.total ?? 0],
              ["Processados", data?.summary.processed ?? 0],
              ["Falhas", data?.summary.failed ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 text-xl font-semibold">{value}</div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium">Conversões identificadas</h4>
            {data?.sources.length ? (
              <div className="overflow-hidden rounded-md border border-border">
                {data.sources.map((source) => (
                  <div key={source.event_identifier} className="flex items-center justify-between gap-4 border-b border-border px-3 py-2 last:border-0">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{source.event_identifier}</div>
                      <div className="text-xs text-muted-foreground">Último envio: {formatDate(source.last_received_at)}</div>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {source.processed}/{source.total} processados
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma conversão recebida ainda.</p>
            )}
          </div>

          <DialogFooter className="sm:justify-between gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="gap-2 text-destructive">
                  <Unplug className="h-4 w-4" /> Desconectar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Desconectar RD Station?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O webhook será removido e novas conversões deixarão de entrar. Leads e históricos existentes serão preservados.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={disconnect} disabled={disconnecting}>
                    Desconectar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button onClick={saveSettings} disabled={saving || !empreendimentoId}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
