// Entrada da interpretação de texto da secretária (fase 1), chamada pelo
// worker/webhook existente para mensagens que NÃO são o comando legado
// ACEITAR/RECUSAR+código. Autenticação pelo mesmo segredo de webhook validado
// via hub_secretary_runtime; identidade empresa/corretor vem só do canal e
// do telefone resolvidos no servidor. Responde 503 (não instalado) enquanto
// os objetos SQL candidatos da fase 1 não existirem no banco.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { processSecretaryMessage } from "@/lib/secretary-engine";
import {
  createSecretaryDeps,
  resolveSender,
  SecretaryNotInstalledError,
} from "@/lib/secretary-adapter.server";

const bodySchema = z
  .object({
    phone: z.string().trim().regex(/^\d{10,15}$/),
    eventId: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(500),
  })
  .strict();

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/secretary/interpret")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-hub-webhook-secret")?.trim() ?? "";
        if (token.length < 32 || token.length > 512) return json({ error: "Unauthorized" }, 401);

        let payload: z.infer<typeof bodySchema>;
        try {
          payload = bodySchema.parse(await request.json());
        } catch {
          return json({ error: "Payload inválido" }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Valida o segredo e resolve a empresa pelo canal, como o fluxo atual.
        const { data: config, error: configError } = await supabaseAdmin.rpc(
          "hub_secretary_runtime",
          { p_kind: "webhook", p_token: token },
        );
        if (configError || !config) return json({ error: "Unauthorized" }, 401);
        const instance = (config as { instance?: string }).instance;
        if (!instance) return json({ error: "Unauthorized" }, 401);

        try {
          const sender = await resolveSender(supabaseAdmin, instance, payload.phone);
          if (!sender) return json({ status: "ignored" });

          const result = await processSecretaryMessage(
            payload.body,
            {
              companyId: sender.companyId,
              memberId: sender.memberId,
              memberActive: sender.memberActive,
              crmEnabled: sender.crmEnabled,
              eventId: payload.eventId,
              channel: "whatsapp",
            },
            createSecretaryDeps(supabaseAdmin),
          );
          return json(result);
        } catch (error) {
          if (error instanceof SecretaryNotInstalledError) {
            return json({ error: "Interpretação de texto não instalada" }, 503);
          }
          throw error;
        }
      },
    },
  },
});
