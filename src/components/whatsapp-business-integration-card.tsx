import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, MessageCircle, Plug, Unplug } from "lucide-react";
import { toast } from "sonner";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import {
  disconnectWhatsApp,
  finishWhatsAppEmbeddedSignup,
  getWhatsAppIntegrationStatus,
  startWhatsAppEmbeddedSignup,
  type WhatsAppEmbeddedStart,
} from "@/lib/whatsapp-embedded.functions";
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

type FacebookLoginResponse = {
  authResponse?: { code?: string };
  status?: string;
};

type FacebookSdk = {
  init: (options: Record<string, unknown>) => void;
  login: (
    callback: (response: FacebookLoginResponse) => void,
    options: Record<string, unknown>,
  ) => void;
};

type EmbeddedSignupAssets = {
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

let facebookSdkPromise: Promise<FacebookSdk> | null = null;

function loadFacebookSdk(config: WhatsAppEmbeddedStart): Promise<FacebookSdk> {
  if (!facebookSdkPromise) {
    facebookSdkPromise = new Promise((resolve, reject) => {
      const initialize = () => {
        if (!window.FB) {
          reject(new Error("SDK do Facebook não foi carregado"));
          return;
        }
        resolve(window.FB);
      };

      if (window.FB) {
        initialize();
        return;
      }

      window.fbAsyncInit = initialize;
      const existing = document.getElementById("facebook-jssdk");
      if (existing) return;

      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.src = "https://connect.facebook.net/pt_BR/sdk.js";
      script.onerror = () => reject(new Error("Não foi possível carregar o SDK do Facebook"));
      document.head.appendChild(script);
    });
  }

  return facebookSdkPromise.then((sdk) => {
    sdk.init({
      appId: config.appId,
      autoLogAppEvents: true,
      xfbml: false,
      version: config.graphVersion,
    });
    return sdk;
  });
}

function runEmbeddedSignup(
  sdk: FacebookSdk,
  config: WhatsAppEmbeddedStart,
): Promise<{ code: string; assets: EmbeddedSignupAssets }> {
  return new Promise((resolve, reject) => {
    let code: string | null = null;
    let assets: EmbeddedSignupAssets | null = null;
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", messageHandler);
      window.clearTimeout(timeout);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    const complete = () => {
      if (settled || !code || !assets) return;
      settled = true;
      cleanup();
      resolve({ code, assets });
    };
    const messageHandler = (event: MessageEvent) => {
      if (
        event.origin !== "https://www.facebook.com" &&
        event.origin !== "https://web.facebook.com"
      ) {
        return;
      }

      let payload: unknown = event.data;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      const message = payload as {
        type?: string;
        event?: string;
        data?: { waba_id?: string; phone_number_id?: string; business_id?: string };
      };
      if (message.type !== "WA_EMBEDDED_SIGNUP") return;
      if (message.event === "CANCEL" || message.event === "ERROR") {
        fail("A conexão com o WhatsApp foi cancelada antes da conclusão");
        return;
      }
      if (message.event !== "FINISH" || !message.data?.waba_id || !message.data.phone_number_id) {
        return;
      }
      assets = {
        wabaId: message.data.waba_id,
        phoneNumberId: message.data.phone_number_id,
        businessId: message.data.business_id,
      };
      complete();
    };

    const timeout = window.setTimeout(
      () => fail("A conexão com o WhatsApp expirou. Tente novamente."),
      2 * 60 * 1000,
    );
    window.addEventListener("message", messageHandler);

    sdk.login(
      (response) => {
        if (!response.authResponse?.code) {
          fail("O Facebook não retornou autorização para concluir a conexão");
          return;
        }
        code = response.authResponse.code;
        complete();
      },
      {
        config_id: config.configId,
        display: "popup",
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  });
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

export function WhatsAppBusinessIntegrationCard() {
  const { activeEmpresaId } = useActiveEmpresa();
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["whatsapp-integration-status", activeEmpresaId],
    enabled: Boolean(activeEmpresaId),
    queryFn: getWhatsAppIntegrationStatus,
    retry: false,
  });

  useEffect(() => {
    if (!data?.configured) return;
    void startWhatsAppEmbeddedSignup()
      .then(loadFacebookSdk)
      .catch(() => {
        // The connect action will show a useful error if preloading fails.
      });
  }, [data?.configured]);

  const connection = data?.connection ?? null;
  const connected = connection?.status === "connected";
  const needsAttention = Boolean(connection && !connected);

  const handleConnect = async () => {
    try {
      setConnecting(true);
      const config = await startWhatsAppEmbeddedSignup();
      const sdk = await loadFacebookSdk(config);
      const result = await runEmbeddedSignup(sdk, config);
      await finishWhatsAppEmbeddedSignup({
        sessionId: config.sessionId,
        code: result.code,
        wabaId: result.assets.wabaId,
        phoneNumberId: result.assets.phoneNumberId,
        businessId: result.assets.businessId,
      });
      await queryClient.invalidateQueries({
        queryKey: ["whatsapp-integration-status", activeEmpresaId],
      });
      toast.success("WhatsApp Business conectado com sucesso");
    } catch (connectError) {
      toast.error(
        connectError instanceof Error ? connectError.message : "Falha ao conectar o WhatsApp",
      );
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setDisconnecting(true);
      const result = await disconnectWhatsApp();
      await queryClient.invalidateQueries({
        queryKey: ["whatsapp-integration-status", activeEmpresaId],
      });
      if (result.warning) {
        toast.warning("Conexão removida do Hub, mas a assinatura na Meta precisa ser revisada");
      } else {
        toast.success("WhatsApp Business desconectado");
      }
    } catch (disconnectError) {
      toast.error(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Falha ao desconectar o WhatsApp",
      );
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Card
      className="p-5"
      style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="flex items-start gap-4">
        <div
          className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: "rgba(37,211,102,0.12)" }}
        >
          <MessageCircle className="h-6 w-6" style={{ color: "#16a34a" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-foreground">WhatsApp Business</h3>
            {isLoading ? (
              <Badge variant="secondary" className="text-[10px]">
                …
              </Badge>
            ) : connected ? (
              <Badge
                className="text-[10px] border-0"
                style={{ backgroundColor: "var(--success-bg)", color: "var(--success)" }}
              >
                Conectado
              </Badge>
            ) : needsAttention ? (
              <Badge variant="destructive" className="text-[10px]">
                Requer atenção
              </Badge>
            ) : (
              <Badge
                className="text-[10px] border-0"
                style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}
              >
                Não conectado
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Conecte a conta e o número do cliente pelo fluxo oficial da Meta
          </p>

          {connection ? (
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">
                {data?.phone?.verified_name ?? connection.business_name ?? "Conta WhatsApp"}
              </p>
              <p>{data?.phone?.display_phone_number ?? "Número não informado"}</p>
              <p>WABA: {connection.waba_id}</p>
              <p>Conectado em {formatDate(connection.connected_at)}</p>
              {connection.webhook_subscribed && connection.phone_registered ? (
                <p className="flex items-center gap-1 text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Webhook e número registrados
                </p>
              ) : null}
              {connection.last_error ? (
                <p className="flex items-start gap-1 text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {connection.last_error}
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="mt-3 text-xs text-destructive">
              Não foi possível consultar o status desta integração.
            </p>
          ) : null}
          {!isLoading && data && !data.configured ? (
            <p className="mt-3 text-xs text-amber-600">
              Configuração técnica pendente no aplicativo Meta da Katsuki.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {!connection ? (
              <Button
                size="sm"
                className="gap-2"
                disabled={connecting || !data?.configured}
                style={{ backgroundColor: "#16a34a", color: "#fff" }}
                onClick={handleConnect}
              >
                <Plug className="h-4 w-4" />
                {connecting ? "Concluindo conexão..." : "Conectar WhatsApp"}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={connecting || !data?.configured}
                  onClick={handleConnect}
                >
                  <Plug className="h-4 w-4" />
                  {connecting ? "Concluindo..." : "Reconectar"}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 text-destructive"
                      disabled={disconnecting}
                    >
                      <Unplug className="h-4 w-4" /> Desconectar
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Desconectar WhatsApp Business?</AlertDialogTitle>
                      <AlertDialogDescription>
                        O Hub deixará de receber eventos deste WABA pelo aplicativo da Katsuki. O
                        número e a conta do cliente não serão excluídos da Meta.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDisconnect}>Desconectar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
          {!connection ? (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Ao continuar, você concorda com os{" "}
              <a className="underline" href="/termos-de-uso" target="_blank" rel="noreferrer">
                Termos de Uso
              </a>{" "}
              e a{" "}
              <a
                className="underline"
                href="/politica-de-privacidade"
                target="_blank"
                rel="noreferrer"
              >
                Política de Privacidade
              </a>
              .
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
