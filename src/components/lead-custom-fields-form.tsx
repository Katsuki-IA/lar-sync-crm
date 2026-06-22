import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  LeadCustomField,
  LeadCustomFieldValue,
  LeadCustomFieldValues,
} from "@/lib/lead-custom-fields";

type Props = {
  fields: LeadCustomField[];
  values: LeadCustomFieldValues;
  errors?: Record<number, string>;
  onChange: (fieldId: number, value: LeadCustomFieldValue) => void;
  disabled?: boolean;
};

const EMPTY_SELECT_VALUE = "__crm_empty_custom_field__";

export function LeadCustomFieldsForm({ fields, values, errors = {}, onChange, disabled }: Props) {
  if (fields.length === 0) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {fields.map((field) => {
        const value = values[field.id] ?? (field.tipo === "checkbox" ? [] : "");
        const error = errors[field.id];

        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={`custom-field-${field.id}`}>
              {field.nome}
              {field.obrigatorio ? " *" : ""}
            </Label>

            {field.tipo === "text" && (
              <Input
                id={`custom-field-${field.id}`}
                value={typeof value === "string" ? value : ""}
                onChange={(event) => onChange(field.id, event.target.value)}
                disabled={disabled}
                aria-invalid={Boolean(error)}
              />
            )}

            {field.tipo === "select" && (
              <Select
                value={
                  typeof value === "string" && value ? value : EMPTY_SELECT_VALUE
                }
                onValueChange={(nextValue) =>
                  onChange(field.id, nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)
                }
                disabled={disabled}
              >
                <SelectTrigger id={`custom-field-${field.id}`} aria-invalid={Boolean(error)}>
                  <SelectValue placeholder="Selecionar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_SELECT_VALUE}>
                    {field.obrigatorio ? "Selecionar" : "Não informado"}
                  </SelectItem>
                  {field.opcoes.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {field.tipo === "checkbox" && (
              <div
                id={`custom-field-${field.id}`}
                className="grid gap-2 rounded-md border border-input p-3"
                aria-invalid={Boolean(error)}
              >
                {field.opcoes.map((option) => {
                  const selected = Array.isArray(value) && value.includes(option);
                  return (
                    <label key={option} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={selected}
                        disabled={disabled}
                        onCheckedChange={(checked) => {
                          const current = Array.isArray(value) ? value : [];
                          onChange(
                            field.id,
                            checked
                              ? [...current, option]
                              : current.filter((item) => item !== option),
                          );
                        }}
                      />
                      <span>{option}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        );
      })}
    </div>
  );
}
