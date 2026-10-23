import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { canManageDefinitions } from './definition-permissions';

const id = z.number().int().positive();
const name = z.string().trim().min(1).max(120);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

async function authorize(supabase: { rpc: (name: 'crm_current_role') => PromiseLike<{ data: unknown; error: unknown }> }) {
  // DB function derives role from auth.uid() and checks the account is active.
  const { data: role, error } = await supabase.rpc('crm_current_role');
  if (error || !canManageDefinitions(role))
    throw new Error('Somente super_admin pode configurar etapas do Atendimento IA e definições de tags.');
}

export const saveCompanyDefinition = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    companyId: id,
    kind: z.enum(['stage', 'tag']),
    id: id.nullable(),
    revision: z.number().int().nonnegative().nullable(),
    values: z.record(z.unknown()),
  }).strict().parse(input))
  .handler(async ({ data, context }) => {
    await authorize(context.supabase);
    // Generated types omit SQL nullability for create/revision arguments.
    const client = context.supabase as unknown as SupabaseClient;
    const { data: result, error } = await client.rpc('hub_save_configuration', {
      p_company_id: data.companyId, p_kind: data.kind, p_id: data.id,
      p_revision: data.revision, p_data: data.values,
    });
    if (error) throw new Error(error.message);
    return result;
  });

const globalSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('crm_global_funnel_rename'), name }).strict(),
  z.object({ operation: z.literal('crm_global_stage_create'), name }).strict(),
  z.object({ operation: z.literal('crm_global_stage_update'), id, name }).strict(),
  z.object({ operation: z.literal('crm_global_stage_delete'), id }).strict(),
  z.object({ operation: z.literal('crm_global_stages_reorder'), ids: z.array(id).min(1) }).strict(),
  z.object({ operation: z.literal('crm_global_tag_create'), name, color }).strict(),
  z.object({ operation: z.literal('crm_global_tag_update'), id, name, color }).strict(),
  z.object({ operation: z.literal('crm_global_tag_delete'), id }).strict(),
]);

export const mutateGlobalDefinition = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => globalSchema.parse(input))
  .handler(async ({ data, context }) => {
    await authorize(context.supabase);
    const args = {
      ...('id' in data ? { p_id: data.id } : {}),
      ...('name' in data ? { p_nome: data.name } : {}),
      ...('color' in data ? { p_cor: data.color } : {}),
      ...('ids' in data ? { p_ids: data.ids } : {}),
    };
    const { error } = await context.supabase.rpc(data.operation, args as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });