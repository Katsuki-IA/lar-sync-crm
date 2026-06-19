export type MetaLeadFieldData = {
  name?: string;
  values?: unknown[];
};

export function normalizeBrazilPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return { original: value, digits, normalized: "" };
  }

  let nationalNumber = digits;
  if (nationalNumber.startsWith("55") && nationalNumber.length > 11) {
    nationalNumber = nationalNumber.slice(2);
  }
  if (nationalNumber.startsWith("0") && nationalNumber.length > 10) {
    nationalNumber = nationalNumber.slice(1);
  }

  return {
    original: value,
    digits,
    normalized: `55${nationalNumber}`,
  };
}

function fieldValueToString(values: unknown[] | undefined) {
  return (values ?? [])
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value).trim())
    .filter(Boolean)
    .join(", ");
}

function normalizeFieldKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const CRM_FIELD_ALIASES: Record<string, string[]> = {
  nome: ["full_name", "name", "nome", "nome_completo"],
  telefone: [
    "phone_number",
    "phone",
    "telefone",
    "mobile_phone",
    "cell_phone",
    "whatsapp",
  ],
  email: ["email", "email_address"],
};

const CRM_FIELD_PATTERNS: Record<string, RegExp> = {
  nome: /(^|_)(full_name|name|nome|nome_completo)(_|$)/,
  telefone: /(^|_)(phone|phone_number|telefone|fone|celular|mobile|whatsapp)(_|$)/,
  email: /(^|_)(email|email_address)(_|$)/,
};

export function createMetaFieldValueMap(fieldData: MetaLeadFieldData[]) {
  const values = new Map<string, string>();

  for (const field of fieldData) {
    const key = field.name?.trim();
    if (!key) continue;
    const value = fieldValueToString(field.values);
    values.set(key, value);
    values.set(key.toLowerCase(), value);
    values.set(normalizeFieldKey(key), value);
  }

  return values;
}

export function getMappedMetaValue(args: {
  values: Map<string, string>;
  mapping: Record<string, string>;
  crmField: string;
}) {
  const metaField = Object.entries(args.mapping).find(([, crmField]) => crmField === args.crmField);
  if (metaField) {
    const mappedValue =
      args.values.get(metaField[0]) ??
      args.values.get(metaField[0].toLowerCase()) ??
      args.values.get(normalizeFieldKey(metaField[0]));
    if (mappedValue) return mappedValue;
  }

  for (const alias of CRM_FIELD_ALIASES[args.crmField] ?? []) {
    const value = args.values.get(alias) ?? args.values.get(normalizeFieldKey(alias));
    if (value) return value;
  }

  const pattern = CRM_FIELD_PATTERNS[args.crmField];
  if (pattern) {
    for (const [key, value] of args.values) {
      if (value && pattern.test(normalizeFieldKey(key))) return value;
    }
  }

  return "";
}
