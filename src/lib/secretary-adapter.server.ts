// Adaptador server-side que liga a engine da secretária aos objetos hub_*
// do banco. Usa somente RPCs (incluindo os candidatos da fase 1); quando um
// objeto ainda não existe no banco, falha fechado com "not_installed".
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SecretaryDeps, SecretaryResult } from "./secretary-engine";
import { interpretSecretaryText } from "./secretary-ai.server";
import { isSecretaryTone, type PendingOffer } from "./secretary-interpreter";

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
    /does not exist|not found/i.test(error.message ?? "")
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
    async findIncoming(companyId, eventId) {
      const row = await call<{
        member_id: string;
        body: string;
        result: SecretaryResult;
      } | null>(admin, "hub_secretary_find_incoming", {
        p_company_id: companyId,
        p_event_id: eventId,
      });
      if (!row) return null;
      return { memberId: row.member_id, body: row.body, result: row.result };
    },
    async recordIncoming(companyId, eventId, memberId, body, result) {
      await call(admin, "hub_secretary_record_incoming", {
        p_company_id: companyId,
        p_event_id: eventId,
        p_member_id: memberId,
        p_body: body,
        p_result: result,
      });
    },
    async listPendingOffers(companyId, memberId) {
      const rows = await call<
        Array<{ id: string; code: string; title: string; expires_at: string }>
      >(admin, "hub_secretary_list_pending_offers", {
        p_company_id: companyId,
        p_member_id: memberId,
      });
      return (rows ?? []).map(
        (r): PendingOffer => ({ id: r.id, code: r.code, title: r.title, expiresAt: r.expires_at }),
      );
    },
    async listMyLeads(companyId, memberId, limit) {
      const rows = await call<Array<{ id: number; title: string; stage: string | null }>>(
        admin,
        "hub_secretary_list_member_leads",
        { p_company_id: companyId, p_member_id: memberId, p_limit: limit },
      );
      return rows ?? [];
    },
    async respondOffer(offerId, action, memberId) {
      return call<{ status: string }>(admin, "hub_secretary_respond_offer", {
        p_offer: offerId,
        p_action: action,
        p_member: memberId,
      });
    },
    async enqueueReply(companyId, memberId, body) {
      await call(admin, "hub_secretary_enqueue_reply", {
        p_company_id: companyId,
        p_member_id: memberId,
        p_body: body,
      });
    },
    async interpret(text, settings) {
      return interpretSecretaryText({
        text,
        tone: settings.tone,
        basePrompt: settings.basePrompt,
      });
    },
    async loadSettings(companyId) {
      const row = await call<{ enabled?: unknown; tone?: unknown; base_prompt?: unknown } | null>(
        admin,
        "hub_secretary_ai_get",
        { p_company_id: companyId },
      );
      return {
        enabled: row?.enabled === true,
        tone: isSecretaryTone(row?.tone) ? row.tone : "cordial",
        basePrompt: typeof row?.base_prompt === "string" ? row.base_prompt : null,
      };
    },
  };
}
