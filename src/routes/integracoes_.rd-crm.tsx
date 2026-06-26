import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { exchangeExternalCrmRdCode } from "@/lib/external-crms.functions";

export const Route = createFileRoute("/integracoes_/rd-crm")({
  component: RdCrmOAuthCallback,
});

function RdCrmOAuthCallback() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("Conectando o RD Station como CRM externo...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error_description") ?? params.get("error");
    const send = (payload: Record<string, unknown>) => {
      window.opener?.postMessage({ source: "external-crm-rd-oauth", ...payload }, window.location.origin);
    };

    if (error) {
      setStatus("error");
      setMessage(error);
      send({ ok: false, error });
      setTimeout(() => window.close(), 1500);
      return;
    }
    if (!code || !state) {
      const text = "Retorno do RD Station incompleto";
      setStatus("error");
      setMessage(text);
      send({ ok: false, error: text });
      return;
    }

    void (async () => {
      try {
        await exchangeExternalCrmRdCode({ code, state });
        setStatus("ok");
        setMessage("RD Station CRM conectado com sucesso.");
        send({ ok: true });
        setTimeout(() => window.close(), 800);
      } catch (exchangeError) {
        const text = exchangeError instanceof Error ? exchangeError.message : "Erro desconhecido";
        setStatus("error");
        setMessage(text);
        send({ ok: false, error: text });
      }
    })();
  }, []);

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ backgroundColor: "var(--bg)" }}
    >
      <div
        className="max-w-sm w-full rounded-xl border p-6 text-center"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="text-sm font-medium text-foreground mb-2">
          {status === "loading" ? "Processando..." : status === "ok" ? "Sucesso" : "Falha"}
        </div>
        <div className="text-xs text-muted-foreground">{message}</div>
      </div>
    </div>
  );
}
