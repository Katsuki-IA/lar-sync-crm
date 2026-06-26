import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { exchangeRdCode } from "@/lib/rd-oauth.functions";

export const Route = createFileRoute("/integracoes_/rd")({
  component: RdOAuthCallback,
});

function RdOAuthCallback() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("Conectando com o RD Station...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error_description") ?? params.get("error");
    const oauthSource = getOAuthSource(state);
    const send = (payload: Record<string, unknown>) => {
      window.opener?.postMessage({ source: oauthSource, ...payload }, window.location.origin);
    };

    if (error) {
      setStatus("error");
      setMessage(error);
      send({ ok: false, error });
      setTimeout(() => window.close(), 1500);
      return;
    }
    if (!code || !state) {
      setStatus("error");
      setMessage("Retorno do RD Station incompleto");
      send({ ok: false, error: "Retorno do RD Station incompleto" });
      return;
    }

    void (async () => {
      try {
        await exchangeRdCode({ code, state });
        setStatus("ok");
        setMessage("Conta RD Station conectada com sucesso.");
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

function getOAuthSource(state: string | null) {
  const defaultSource = "rd-oauth";
  if (!state) return defaultSource;
  try {
    const [payload] = state.split(".");
    if (!payload) return defaultSource;
    const padded = payload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as { purpose?: string };
    return parsed.purpose === "external_crm_destination" ? "external-crm-rd-oauth" : defaultSource;
  } catch {
    return defaultSource;
  }
}
