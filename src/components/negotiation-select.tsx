import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NEGOTIATION_OPTIONS, type NegotiationMode } from "@/lib/negotiation";

export function NegotiationSelect({
  value,
  onChange,
  id,
  disabled,
}: {
  value: NegotiationMode;
  onChange: (value: NegotiationMode) => void;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as NegotiationMode)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label="Modalidade de negociação">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {NEGOTIATION_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
