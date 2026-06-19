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

export function createMetaFieldValueMap(fieldData: MetaLeadFieldData[]) {
  const values = new Map<string, string>();

  for (const field of fieldData) {
    const key = field.name?.trim();
    if (!key) continue;
    const value = fieldValueToString(field.values);
    values.set(key, value);
    values.set(key.toLowerCase(), value);
  }

  return values;
}

export function getMappedMetaValue(args: {
  values: Map<string, string>;
  mapping: Record<string, string>;
  crmField: string;
}) {
  const metaField = Object.entries(args.mapping).find(([, crmField]) => crmField === args.crmField);
  if (!metaField) return "";
  return args.values.get(metaField[0]) ?? args.values.get(metaField[0].toLowerCase()) ?? "";
}
