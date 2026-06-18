const DEFAULT_APP_ORIGIN = "https://lar-sync-crm.lovable.app";

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }

  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const appOrigin = Deno.env.get("APP_ORIGIN") ?? DEFAULT_APP_ORIGIN;
  const payload = {
    source: "meta-oauth-callback",
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
    error: url.searchParams.get("error"),
    errorDescription: url.searchParams.get("error_description"),
  };

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Conexao Meta</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0b0d13;
        color: #f8fafc;
      }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
      }
      main {
        width: min(360px, calc(100vw - 32px));
        border: 1px solid #2a2d3a;
        border-radius: 10px;
        background: #13151f;
        padding: 24px;
        text-align: center;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 18px;
      }
      p {
        margin: 0;
        color: #a7b0d7;
        font-size: 14px;
        line-height: 1.45;
      }
      button {
        margin-top: 18px;
        border: 0;
        border-radius: 8px;
        padding: 10px 14px;
        background: #ef2b63;
        color: #fff;
        font-weight: 600;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Finalizando conexao</h1>
      <p>Esta janela sera fechada automaticamente.</p>
      <button type="button" onclick="window.close()">Fechar</button>
    </main>
    <script>
      const targetOrigin = ${safeJson(appOrigin)};
      const payload = ${safeJson(payload)};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, targetOrigin);
          setTimeout(() => window.close(), 400);
        }
      } catch (error) {
        console.error(error);
      }
    </script>
  </body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    },
  });
});
