import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { exchangeMetaCode } from "@/lib/meta-oauth.functions";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("code") || params.has("error")) return;

    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    throw redirect({ to: "/dashboard" });
  },
  component: MetaOAuthRootCallback,
});

function MetaOAuthRootCallback() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("Conectando com o Facebook...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error_description") ?? params.get("error");

    const send = (payload: Record<string, unknown>) => {
      try {
        window.opener?.postMessage({ source: "meta-oauth", ...payload }, window.location.origin);
      } catch {
        // Popup may be detached or blocked by the browser.
      }
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
      setMessage("Retorno do Meta incompleto");
      send({ ok: false, error: "Retorno do Meta incompleto" });
      return;
    }

    (async () => {
      try {
        const result = await exchangeMetaCode({ code, state });
        setStatus("ok");
        setMessage("Conta Meta conectada com sucesso.");
        send({ ok: true, connection: result.connection });
        setTimeout(() => window.close(), 800);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro desconhecido";
        setStatus("error");
        setMessage(msg);
        send({ ok: false, error: msg });
      }
    })();
  }, []);

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ backgroundColor: "#0B0D14" }}
    >
      <div
        className="max-w-sm w-full rounded-xl border p-6 text-center"
        style={{ backgroundColor: "#13151F", borderColor: "#2A2D3A" }}
      >
        <div className="text-sm font-medium text-foreground mb-2">
          {status === "loading" ? "Processando..." : status === "ok" ? "Sucesso" : "Falha"}
        </div>
        <div className="text-xs text-muted-foreground">{message}</div>
      </div>
    </div>
  );
}
