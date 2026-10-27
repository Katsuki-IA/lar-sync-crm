// Local-only substitutes for authentication and data access. No network or real records.
const tags = [
  { id: 1, nome: "Investidor", cor: "#C14F21", descricao: "Compra para renda ou revenda", ativo: true, revision: 0, uses: 23 },
  { id: 2, nome: "Financiamento", cor: "#2563EB", descricao: "Vai financiar; enviar simulação", ativo: true, revision: 0, uses: 61 },
  { id: 3, nome: "Urgente", cor: "#EF4444", descricao: "Quer fechar em até 30 dias", ativo: true, revision: 0, uses: 14 },
];
const system = [{ id: 11, nome: "Cliente Respondeu", cor: "#16A34A" }, { id: 12, nome: "Qualificado", cor: "#16A34A" }, { id: 13, nome: "Visita Agendada IA", cor: "#8B5CF6" }];
const selected = new Set([1]);
export const useCrmUser = () => ({ data: { id: "preview", active: true, role: "manager" } });
export const useCompanyModules = () => ({ data: { crm: true, atendimento_ia: true } });
export const inputClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
export const useServerFn = <T>(fn: T) => fn;
export async function saveCommercialTag({ data }: { data: { id: number | null; nome: string; cor: string; descricao: string; ativo: boolean } }) {
  const old = tags.find(t => t.id === data.id);
  if (old) Object.assign(old, data, { revision: old.revision + 1 });
  else tags.push({ ...data, id: tags.length + 1, uses: 0, revision: 0 });
}
export const db = {
  async rpc(name: string, args: { p_tag?: number; p_applied?: boolean }) {
    if (name === "hub_set_opportunity_tag") { if (args.p_applied) selected.add(args.p_tag!); else selected.delete(args.p_tag!); }
    return { data: tags.map(t => ({ ...t })), error: null };
  },
  from(name: string) {
    const result = () => ({ data: name === "crm_tags" ? system : [...selected].map(tag_id => ({ tag_id })), error: null });
    const chain = { select: () => chain, eq: () => chain, order: () => chain, then: (fn: (r: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(fn) };
    return chain;
  },
};
