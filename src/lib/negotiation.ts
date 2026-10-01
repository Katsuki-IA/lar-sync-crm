export const NEGOTIATION_OPTIONS = [
  { value: "venda", label: "Venda" },
  { value: "locacao", label: "Locação" },
  { value: "ambos", label: "Ambos (venda e locação)" },
] as const;
export type NegotiationMode = (typeof NEGOTIATION_OPTIONS)[number]["value"];

export function negotiationLabel(value: NegotiationMode) {
  return NEGOTIATION_OPTIONS.find((option) => option.value === value)?.label ?? "Venda";
}

export function canManageNegotiation(role: string, ownCompany: number | null, companyId: number) {
  return role === "super_admin" || (role === "manager" && ownCompany === companyId);
}
