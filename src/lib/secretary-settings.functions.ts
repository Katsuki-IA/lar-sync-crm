// Configuração da interpretação de texto da secretária (fase 1).
// Escrita restrita a super_admin com papel derivado do banco (crm_current_role),
// nunca do cliente. Depende dos objetos SQL candidatos da fase 1; quando não
// instalados, reporta installed=false sem fingir sucesso.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { isSecretaryTone, SECRETARY_TONES } from './secretary-interpreter';

const companySchema = z.object({ companyId: z.number().int().positive() }).strict();
const saveSchema = z
  .object({
    companyId: z.number().int().positive(),
    enabled: z.boolean(),
    tone: z.enum(SECRETARY_TONES),
    basePrompt: z.string().trim().max(2000).nullable(),
  })
  .strict();

async function currentRole(supabase: { rpc: (name: 'crm_current_role') => PromiseLike<{ data: unknown; error: unknown }> }) {
  const { data, error } = await supabase.rpc('crm_current_role');
  if (error) return null;
  return typeof data === 'string' ? data : null;
}

function isMissingObject(error: { message?: string; code?: string } | null) {
  if (!error) return false;
  return error.code === '42883' || error.code === 'PGRST202' || /does not exist|not found/i.test(error.message ?? '');
}

export const getSecretaryAiSettings = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => companySchema.parse(input))
  .handler(async ({ data, context }) => {
    const role = await currentRole(context.supabase);
    if (role !== 'manager' && role !== 'gestor' && role !== 'super_admin')
      throw new Error('Configuração restrita ao gestor da empresa.');
    const client = context.supabase as unknown as SupabaseClient;
    const { data: settings, error } = await client.rpc('hub_secretary_ai_get', {
      p_company_id: data.companyId,
    });
    if (isMissingObject(error)) return { installed: false as const };
    if (error) throw new Error(error.message);
    const row = settings as { enabled?: unknown; tone?: unknown; base_prompt?: unknown } | null;
    return {
      installed: true as const,
      enabled: row?.enabled === true,
      tone: isSecretaryTone(row?.tone) ? row.tone : 'cordial',
      basePrompt: typeof row?.base_prompt === 'string' ? row.base_prompt : null,
      canEdit: role === 'super_admin',
      // Booleano de presença da credencial no servidor; nunca expõe o valor.
      aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    };
  });

export const saveSecretaryAiSettings = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => saveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const role = await currentRole(context.supabase);
    if (role !== 'super_admin')
      throw new Error('Somente super_admin pode configurar a interpretação de texto da secretária.');
    const client = context.supabase as unknown as SupabaseClient;
    const { error } = await client.rpc('hub_secretary_ai_save', {
      p_company_id: data.companyId,
      p_enabled: data.enabled,
      p_tone: data.tone,
      p_base_prompt: data.basePrompt,
    });
    if (isMissingObject(error))
      throw new Error('Interpretação de texto ainda não instalada no banco desta empresa.');
    if (error) throw new Error(error.message);
    return { ok: true };
  });
