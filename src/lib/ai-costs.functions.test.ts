import { beforeEach, describe, expect, it, vi } from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@tanstack/react-start',()=>({createServerFn:()=>({middleware(){return this;},inputValidator(){return this;},handler(fn:unknown){return fn;}})}));
vi.mock('@/integrations/supabase/auth-middleware',()=>({requireSupabaseAuth:{}}));
vi.mock('@/integrations/supabase/client.server',()=>({supabaseAdmin:{rpc}}));
import { getAiCosts } from './ai-costs.functions';
function context(role:string,active=true){const query={select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{role,active},error:null})};return {supabase:{from:()=>query},userId:'authenticated-user'};}
describe('AI cost report authorization',()=>{
 beforeEach(()=>rpc.mockReset());
 it.each(['manager','agent','analyst'])('rejects %s before privileged query',async role=>{
  await expect((getAiCosts as any)({data:{month:'2026-11'},context:context(role)})).rejects.toThrow('restrito');expect(rpc).not.toHaveBeenCalled();
 });
 it('rejects inactive super admins',async()=>{
  await expect((getAiCosts as any)({data:{month:'2026-11'},context:context('super_admin',false)})).rejects.toThrow('restrito');expect(rpc).not.toHaveBeenCalled();
 });
 it('queries the selected month for an active super admin',async()=>{
  rpc.mockResolvedValue({data:{rows:[]},error:null});
  await expect((getAiCosts as any)({data:{month:'2026-11'},context:context('super_admin')})).resolves.toEqual({rows:[]});
  expect(rpc).toHaveBeenCalledWith('ai_cost_monthly_report',{p_month:'2026-11-01'});
 });
});
