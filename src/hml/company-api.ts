// Shared UI contract for HML and native company packages. No privileged client.
export type CompanyModules = {
  id_empresa: number; atendimento_ia: boolean; crm: boolean; revision: number;
  source?: "explicit" | "credentials";
};
export type CompanyCatalogItem = {id: number; nome: string; default_crm: string | null; modules: CompanyModules | null};
type RpcClient = {rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{data: unknown; error: {message: string; code?: string} | null}>};
export function companyApi(client: RpcClient) {
  async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    const {data,error}=await client.rpc(name,args);
    if(error)throw Object.assign(new Error(error.message),{code:error.code});
    return data as T;
  }
  return {
    allowed: () => call<number[]>("hub_get_allowed_empresas"),
    modules: (companyId: number) => call<CompanyModules>("hub_get_company_modules",{p_company_id:companyId}),
    catalog: () => call<CompanyCatalogItem[]>("hub_company_catalog"),
    register: (input: {existingId: number | null; name: string; ia: boolean; crm: boolean; requestId: string}) =>
      call<number>("hub_register_company",{p_existing_id:input.existingId,p_name:input.name.trim(),p_ia:input.ia,p_crm:input.crm,p_request_id:input.requestId}),
    setModules: (companyId: number, ia: boolean, crm: boolean, revision: number) =>
      call<CompanyModules>("hub_set_company_modules",{p_company_id:companyId,p_ia:ia,p_crm:crm,p_expected_revision:revision}),
  };
}
export function normalizeCompanyRole(role: string): "super_admin" | "manager" | "agent" | "analyst" | null {
  const value=role.trim().toLowerCase();
  if(value==='gestor')return 'manager';
  if(value==='corretor')return 'agent';
  return ['super_admin','manager','agent','analyst'].includes(value)?value as 'super_admin'|'manager'|'agent'|'analyst':null;
}
export function permittedCompany(current: number | null, allowed: number[]): number | null {
  return current !== null && allowed.includes(current) ? current : null;
}

