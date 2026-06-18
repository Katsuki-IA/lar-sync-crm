import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { exchangeMetaCode } from "@/lib/meta-oauth.functions";

export const Route = createFileRoute("/integracoes")({
  component: MetaOAuthCallback,
});

function MetaOAuthCallback() {
  const exchange = useServerFn(exchangeMetaCode);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState<string>("Conectando com o Facebook...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error_description") ?? params.get("error");

    const send = (payload: Record<string, unknown>) => {
      try {
        window.opener?.postMessage({ source: "meta-oauth", ...payload }, window.location.origin);
      } catch {}
    };

    if (error) {
      setStatus("error");
      setMessage(error);
      send({ ok: false, error });
      setTimeout(() => window.close(), 1500);
      return;
    }
    if (!code) {
      setStatus("error");
      setMessage("Código de autorização não recebido");
      return;
    }

    (async () => {
      try {
        const result = await exchange({ data: { code } });
        setStatus("ok");
        setMessage("Conta conectada! Você pode fechar esta janela.");
        send({ ok: true, connection: result.connection });
        setTimeout(() => window.close(), 800);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro desconhecido";
        setStatus("error");
        setMessage(msg);
        send({ ok: false, error: msg });
      }
    })();
  }, [exchange]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: "#0B0D14" }}>
      <div className="max-w-sm w-full rounded-xl border p-6 text-center" style={{ backgroundColor: "#13151F", borderColor: "#2A2D3A" }}>
        <div className="text-sm font-medium text-foreground mb-2">
          {status === "loading" ? "Processando..." : status === "ok" ? "Sucesso" : "Falha"}
        </div>
        <div className="text-xs text-muted-foreground">{message}</div>
      </div>
    </div>
  );
}