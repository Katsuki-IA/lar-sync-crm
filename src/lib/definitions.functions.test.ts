import { describe, expect, it, vi } from 'vitest';
import { canManageDefinitions } from './definition-permissions';

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (input: unknown) => unknown = input => input;
    const builder = {
      middleware: () => builder,
      inputValidator: (fn: typeof validate) => { validate = fn; return builder; },
      handler: (fn: (args: unknown) => unknown) => (args: { data: unknown; context: unknown }) =>
        fn({ ...args, data: validate(args.data) }),
    };
    return builder;
  },
}));
vi.mock('@/integrations/supabase/auth-middleware', () => ({ requireSupabaseAuth: {} }));
import { saveCompanyDefinition, mutateGlobalDefinition } from './definitions.functions';

const company = (kind: 'stage' | 'tag') => ({ companyId: 25, kind, id: 1, revision: 0, values: { nome: 'Etapa', cor: '#C14F21' } });
const globalOperations = [
  { operation: 'crm_global_funnel_rename', name: 'IA' },
  { operation: 'crm_global_stage_create', name: 'Etapa' },
  { operation: 'crm_global_stage_update', id: 1, name: 'Etapa' },
  { operation: 'crm_global_stage_delete', id: 1 },
  { operation: 'crm_global_stages_reorder', ids: [2, 1] },
  { operation: 'crm_global_tag_create', name: 'Tag', color: '#C14F21' },
  { operation: 'crm_global_tag_update', id: 1, name: 'Tag', color: '#C14F21' },
  { operation: 'crm_global_tag_delete', id: 1 },
];

// Exercise actual handlers without performing any writes to real data.
async function invoke(fn: unknown, data: unknown, role: unknown, error: unknown = null) {
  const rpc = vi.fn(async (name: string) => name === 'crm_current_role'
    ? { data: role, error } : { data: { id: 1 }, error: null });
  const call = fn as (args: unknown) => Promise<unknown>;
  const result = call({ data, context: { supabase: { rpc }, userId: 'authenticated-identity', role: 'super_admin' } });
  return { rpc, result };
}

describe('IA stage and tag definition authorization', () => {
  for (const role of ['manager', 'gestor', 'admin', 'company_admin', 'agent', 'corretor', 'analyst', null]) {
    it(`blocks ${role} for both company definitions and every global mutation`, async () => {
      expect(canManageDefinitions(role)).toBe(false);
      for (const [fn, input] of [
        ...(['stage', 'tag'] as const).map(kind => [saveCompanyDefinition, company(kind)]),
        ...globalOperations.map(data => [mutateGlobalDefinition, data]),
      ]) {
        const { rpc, result } = await invoke(fn, input, role);
        await expect(result).rejects.toThrow('Somente super_admin');
        expect(rpc.mock.calls).toEqual([['crm_current_role']]);
      }
    });
  }
  it('allows super_admin for both company definitions and every global mutation', async () => {
    expect(canManageDefinitions('super_admin')).toBe(true);
    for (const [fn, input] of [
      ...(['stage', 'tag'] as const).map(kind => [saveCompanyDefinition, company(kind)]),
      ...globalOperations.map(data => [mutateGlobalDefinition, data]),
    ]) {
      const { rpc, result } = await invoke(fn, input, 'super_admin');
      await expect(result).resolves.toBeDefined();
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(rpc.mock.calls[1][0]).not.toBe('crm_current_role');
    }
  });
  it('fails closed on role lookup errors', async () => {
    const { rpc, result } = await invoke(saveCompanyDefinition, company('tag'), 'super_admin', { message: 'unavailable' });
    await expect(result).rejects.toThrow('Somente super_admin');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('rejects a client-supplied role and a commercial stage kind', async () => {
    for (const data of [{ ...company('stage'), role: 'super_admin' }, { ...company('stage'), kind: 'crm' }]) {
      const { rpc, result } = await invoke(saveCompanyDefinition, data, 'manager');
      await expect(result).rejects.toThrow();
      expect(rpc).not.toHaveBeenCalled();
    }
  });
});