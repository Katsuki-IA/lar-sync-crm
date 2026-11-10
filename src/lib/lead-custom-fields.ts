export type LeadCustomFieldType = "text" | "select" | "checkbox";

export type LeadCustomField = {
  id: number;
  id_empresa: number;
  nome: string;
  tipo: LeadCustomFieldType;
  obrigatorio: boolean;
  opcoes: string[];
  ordem: number;
  ativo: boolean;
  commercial_key?: LeadCommercialKey | null;
};

export const LEAD_COMMERCIAL_KEYS = [
  "empresa_cliente",
  "site",
  "faturamento",
  "volume_whatsapp",
  "oferta",
  "cnpj_status",
] as const;

export type LeadCommercialKey = (typeof LEAD_COMMERCIAL_KEYS)[number];
export type LeadCustomFieldGroup = "commercial" | "custom";

export function parseCommercialKey(value: unknown): LeadCommercialKey | null {
  return typeof value === "string" &&
    (LEAD_COMMERCIAL_KEYS as readonly string[]).includes(value)
    ? (value as LeadCommercialKey)
    : null;
}

export function customFieldGroup(field: LeadCustomField): LeadCustomFieldGroup {
  return parseCommercialKey(field.commercial_key) ? "commercial" : "custom";
}

export function splitCustomFieldsByGroup(fields: LeadCustomField[]) {
  return {
    commercial: fields.filter((field) => customFieldGroup(field) === "commercial"),
    custom: fields.filter((field) => customFieldGroup(field) === "custom"),
  };
}

/** Plano de gravação restrito aos campos do grupo editado: nunca toca outro grupo. */
export function buildGroupSavePlan(
  leadId: number,
  groupFields: LeadCustomField[],
  values: LeadCustomFieldValues,
) {
  const upserts = buildCustomFieldValueRows(leadId, groupFields, values);
  const deleteFieldIds = groupFields
    .filter((field) => !upserts.some((row) => row.field_id === field.id))
    .map((field) => field.id);
  return { upserts, deleteFieldIds };
}

export type LeadCustomFieldValue = string | string[];
export type LeadCustomFieldValues = Record<number, LeadCustomFieldValue>;

export function parseCustomFieldOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((option) => String(option).trim()).filter(Boolean);
}

export function isCustomFieldValueFilled(value: LeadCustomFieldValue | undefined) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
}

export function normalizeCustomFieldValue(
  field: LeadCustomField,
  value: LeadCustomFieldValue | undefined,
): LeadCustomFieldValue {
  if (field.tipo === "checkbox") {
    return Array.isArray(value)
      ? value.filter((option) => field.opcoes.includes(option))
      : [];
  }

  const textValue = typeof value === "string" ? value.trim() : "";
  if (field.tipo === "select" && !field.opcoes.includes(textValue)) return "";
  return textValue;
}

export function isCustomFieldValueValid(
  field: LeadCustomField,
  value: LeadCustomFieldValue | undefined,
) {
  return isCustomFieldValueFilled(normalizeCustomFieldValue(field, value));
}

export function emptyCustomFieldValue(field: LeadCustomField): LeadCustomFieldValue {
  return field.tipo === "checkbox" ? [] : "";
}

export function buildCustomFieldValueRows(
  leadId: number,
  fields: LeadCustomField[],
  values: LeadCustomFieldValues,
) {
  return fields
    .map((field) => {
      const value = normalizeCustomFieldValue(field, values[field.id]);
      return {
        lead_id: leadId,
        field_id: field.id,
        valor_texto: field.tipo === "checkbox" ? null : String(value ?? "").trim(),
        valor_opcoes:
          field.tipo === "checkbox" && Array.isArray(value) ? value : [],
      };
    })
    .filter((row) => isCustomFieldValueFilled(row.valor_texto ?? row.valor_opcoes));
}
