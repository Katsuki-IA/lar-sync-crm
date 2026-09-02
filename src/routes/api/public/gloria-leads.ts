// Leitura agregada de contagem de leads por empreendimento/mês para o painel Glória.
// Somente SELECT agregado no banco. Nenhum dado pessoal de lead é exposto.
import { createFileRoute } from "@tanstack/react-router";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-katsuki-token",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function constantTimeEquals(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index]! ^ b[index]!;
  return diff === 0;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

type EmpreendimentoRow = {
  empresa_id: number | null;
  empresa_nome: string | null;
  empreendimento_id: number;
  empreendimento_nome: string | null;
  leads_mes: number;
  leads_mes_anterior: number;
  leads_respondidos_mes: number;
  ultima_entrada: string | null;
  por_origem: Array<{ origem: string; total: number }>;
};

export const Route = createFileRoute("/api/public/gloria-leads")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders }),
      GET: async ({ request }) => {
        try {
          const expected = process.env["GLORIA_SYNC_TOKEN"];
          if (!expected) {
            console.error("[gloria-leads] GLORIA_SYNC_TOKEN ausente");
            return json({ error: "Integração não configurada" }, 503);
          }
          const provided = request.headers.get("x-katsuki-token") ?? "";
          if (!provided || !constantTimeEquals(provided, expected)) {
            return json({ error: "Token inválido ou ausente no header x-katsuki-token" }, 401);
          }

          const url = new URL(request.url);
          const mesParam = (url.searchParams.get("mes") ?? "").trim();
          const now = new Date();
          const mes = mesParam
            ? mesParam
            : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
          if (!MONTH_PATTERN.test(mes)) {
            return json({ error: "mes inválido: use YYYY-MM" }, 400);
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const rpc = supabaseAdmin as unknown as {
            rpc: (
              fn: string,
              args: Record<string, unknown>,
            ) => Promise<{ data: unknown; error: { message: string } | null }>;
          };

          const result = await rpc.rpc("gloria_leads_por_empreendimento", { p_mes: `${mes}-01` });
          if (result.error) throw new Error(result.error.message);

          const empreendimentos = (result.data as EmpreendimentoRow[] | null) ?? [];

          return json({
            mes,
            gerado_em: new Date().toISOString(),
            empreendimentos,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Erro interno";
          console.error("[gloria-leads]", message);
          return json({ error: "Erro interno" }, 500);
        }
      },
    },
  },
});
