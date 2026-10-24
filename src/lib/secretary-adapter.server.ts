// Adaptador server-side que liga a engine da secretária aos objetos hub_*
// do banco. Toda a execução passa pela RPC transacional pública
// hub_secretary_finalize (wrapper service_role -> private.hub_secretary_finalize);
// a engine não faz leituras/escritas soltas. Quando um objeto ainda não
// existe no banco, falha fechado com "not_installed".
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SecretaryDeps,
  SecretaryMessageContext,
  SecretaryResult,
} from "./secretary-engine";
import { interpretSecretaryText } from "./secretary-ai.server";
import { isSecretaryTone } from "./secretary-interpreter";

export class SecretaryNotInstalledError extends Error {
  constructor() {
    super("Interpretação de texto da secretária não instalada no banco.");
    this.name = "SecretaryNotInstalledError";
  }
}

function missing(error: { message?: string; code?: string } | null) {
  if (!error) return false;
  return (
    error.code === "42883" ||
    error.code === "PGRST202" ||
    /does not exist|not found|permission denied/i.test(error.message ?? "")
  );
}

async function call<T>(admin: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name as never, args as never);
  if (missing(error)) throw new SecretaryNotInstalledError();
  if (error) throw new Error(error.message);
  return data as T;
}

export type ResolvedSender = {
  companyId: number;
  memberId: string;
  memberActive: boolean;
  crmEnabled: boolean;
};

/** Resolve empresa e membro exclusivamente pelo canal (instância) + telefone. */
export async function resolveSender(
  admin: SupabaseClient,
  instance: string,
  phone: string,
): Promise<ResolvedSender | null> {
  const row = await call<{
    company_id: number;
    member_id: string;
    member_active: boolean;
    crm_enabled: boolean;
  } | null>(admin, "hub_secretary_resolve_sender", { p_instance: instance, p_phone: phone });
  if (!row) return null;
  return {
    companyId: row.company_id,
    memberId: row.member_id,
    memberActive: row.member_active === true,
    crmEnabled: row.crm_enabled === true,
  };
}

export function createSecretaryDeps(admin: SupabaseClient): SecretaryDeps {
  return {
    async loadRuntimeSettings(companyId) {
      // Leitura de runtime dedicada (service_role, sem auth.uid()).
      const row = await call<{ enabled?: unknown; tone?: unknown; base_prompt?: unknown } | null>(
        admin,
        "hub_secretary_ai_runtime",
        { p_company_id: companyId },
      );
      return {
        enabled: row?.enabled === true,
        tone: isSecretaryTone(row?.tone) ? row.tone : "cordial",
        basePrompt: typeof row?.base_prompt === "string" ? row.base_prompt : null,
      };
    },
    async interpret(text, settings) {
      return interpretSecretaryText({
        text,
        tone: settings.tone,
        basePrompt: settings.basePrompt,
      });
    },
    async finalize(context: SecretaryMessageContext, body, command) {
      // Uma única chamada transacional: o banco trava o evento, revalida
      // remetente/módulo/configuração/oferta, executa, registra e enfileira.
      return call<SecretaryResult>(admin, "hub_secretary_finalize", {
        p_instance: context.instance,
        p_phone: context.phone,
        p_event_id: context.eventId,
        p_body: body,
        p_command: command,
      });
    },
  };
}
