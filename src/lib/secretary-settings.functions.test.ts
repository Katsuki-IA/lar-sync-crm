import { describe, expect, it, vi } from 'vitest';

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
import { getSecretaryAiSettings, saveSecretaryAiSettings } from './secretary-settings.functions';

const validSave = { companyId: 25, enabled: true, tone: 'cordial', basePrompt: null };

async function invoke(fn: unknown, data: unknown, role: unknown, opts: { rpcError?: unknown; missing?: boolean } = {}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'crm_current_role') return { data: role, error: opts.rpcError ?? null };
    if (opts.missing) return { data: null, error: { code: 'PGRST202', message: 'function not found' } };
    return { data: { enabled: false, tone: 'cordial', base_prompt: null }, error: null };
  });
  const call = fn as (args: unknown) => Promise<unknown>;
  const result = Promise.resolve().then(() => call({ data, context: { supabase: { rpc } } }));
  return { rpc, result };
}

describe('secretary AI settings authorization', () => {
  for (const role of ['manager', 'gestor', 'admin', 'company_admin', 'agent', 'corretor', 'analyst', null]) {
    it(`blocks ${role} from saving tone, rules or activation`, async () => {
      const { rpc, result } = await invoke(saveSecretaryAiSettings, validSave, role);
      await expect(result).rejects.toThrow('Somente super_admin');
      expect(rpc.mock.calls).toEqual([['crm_current_role']]);
    });
  }
  it('allows super_admin to save', async () => {
    const { rpc, result } = await invoke(saveSecretaryAiSettings, validSave, 'super_admin');
    await expect(result).resolves.toEqual({ ok: true });
    expect(rpc.mock.calls[1][0]).toBe('hub_secretary_ai_save');
  });
  it('fails closed when the role lookup fails', async () => {
    const { result } = await invoke(saveSecretaryAiSettings, validSave, 'super_admin', { rpcError: { message: 'down' } });
    await expect(result).rejects.toThrow('Somente super_admin');
  });
  it('rejects invalid tone, client-supplied role and unknown fields', async () => {
    for (const data of [
      { ...validSave, tone: 'engracado' },
      { ...validSave, role: 'super_admin' },
      { ...validSave, basePrompt: 'x'.repeat(2001) },
    ]) {
      const { rpc, result } = await invoke(saveSecretaryAiSettings, data, 'super_admin');
      await expect(result).rejects.toThrow();
      expect(rpc).not.toHaveBeenCalled();
    }
  });
  it('reports not installed instead of faking success', async () => {
    const { result } = await invoke(getSecretaryAiSettings, { companyId: 25 }, 'manager', { missing: true });
    await expect(result).resolves.toEqual({ installed: false });
    const save = await invoke(saveSecretaryAiSettings, validSave, 'super_admin', { missing: true });
    await expect(save.result).rejects.toThrow('não instalada');
  });
  it('blocks read for roles without company management access', async () => {
    const { rpc, result } = await invoke(getSecretaryAiSettings, { companyId: 25 }, 'corretor');
    await expect(result).rejects.toThrow('restrita ao gestor');
    expect(rpc.mock.calls).toEqual([['crm_current_role']]);
  });
});
