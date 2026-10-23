import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db, actionClass, inputClass, secondaryClass } from "./modules";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const groups = {
  company_profile: "Dados da empresa",
  development_description: "Descrição do empreendimento",
  development_commercial: "Condições comerciais",
  development_location: "Endereço de visita",
};
export type Capability = keyof typeof groups;
export type Permission = { crm_user_id: string; revision: number } & Record<Capability, boolean>;
export type Field = {
  key: string;
  label: string;
  group: Capability;
  multiline?: boolean;
  url?: boolean;
};
export const companyFields: Field[] = [
  { key: "nome", label: "Nome da empresa", group: "company_profile" },
  { key: "site", label: "Site", group: "company_profile", url: true },
  { key: "redes_sociais", label: "Redes sociais", group: "company_profile", multiline: true },
];
export const developmentFields: Field[] = [
  ...[
    ["nome", "Nome do empreendimento"],
    ["tipo", "Tipo"],
    ["incorporadora", "Incorporadora"],
    ["localizacao", "Localização"],
    ["tipologia", "Tipologia"],
    ["metragem", "Metragem"],
    ["numero_vagas", "Vagas"],
    ["diferenciais_imovel", "Diferenciais do imóvel"],
    ["diferenciais_condominio", "Diferenciais do condomínio"],
    ["area_lazer", "Lazer"],
    ["outras_info", "Outras informações"],
  ].map(([key, label]) => ({
    key,
    label,
    group: "development_description" as const,
    multiline: [
      "diferenciais_imovel",
      "diferenciais_condominio",
      "area_lazer",
      "outras_info",
    ].includes(key),
  })),
  ...[
    ["preco", "Preço"],
    ["condicao", "Condições de pagamento"],
    ["prazo_entrega", "Prazo de entrega"],
    ["status", "Status comercial"],
  ].map(([key, label]) => ({
    key,
    label,
    group: "development_commercial" as const,
    multiline: key === "condicao",
  })),
  { key: "endereco_visita", label: "Endereço de visita", group: "development_location" },
  { key: "google_maps_link", label: "Link do mapa", group: "development_location", url: true },
];
export type AdminRecord = {
  id: number;
  admin_revision: number;
  nome: string;
  [key: string]: unknown;
};
export function useAdminMutation<T>(
  mutationFn: (data: T) => Promise<unknown>,
  message: string,
  onSaved?: () => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast.success(message);
      onSaved?.();
    },
    onError: async (e: Error) => {
      toast.error(e.message);
      await qc.invalidateQueries();
    },
  });
}
export async function adminRpc(name: string, params: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, params);
  if (error) throw error;
  return data;
}
export function RecordEditor({
  record,
  fields,
  canEdit,
  onSave,
  onCancel,
  pending,
  creating = false,
}: {
  record: AdminRecord;
  fields: Field[];
  canEdit: (group: Capability) => boolean;
  onSave: (patch: Record<string, string | null>) => void;
  onCancel?: () => void;
  pending: boolean;
  creating?: boolean;
}) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((f) => [f.key, String(record[f.key] ?? "")])),
  );
  const patch = Object.fromEntries(
    fields
      .filter(
        (f) => canEdit(f.group) && (creating || values[f.key] !== String(record[f.key] ?? "")),
      )
      .map((f) => [f.key, values[f.key].trim() || null]),
  );
  const editable = fields.some((f) => canEdit(f.group));
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (Object.keys(patch).length) onSave(patch);
      }}
    >
      {[...new Set(fields.map((f) => f.group))].map((group) => (
        <fieldset
          key={group}
          disabled={pending || !canEdit(group)}
          className="hml-form-group space-y-3"
        >
          <legend className="px-2 text-sm font-semibold">
            {groups[group]}{" "}
            {!canEdit(group) && (
              <span className="font-normal text-muted-foreground">· Somente leitura</span>
            )}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields
              .filter((f) => f.group === group)
              .map((f) => (
                <label
                  key={f.key}
                  className={"block text-sm " + (f.multiline ? "sm:col-span-2" : "")}
                >
                  {f.label}
                  {f.multiline ? (
                    <Textarea
                      aria-label={f.label}
                      className={inputClass + " mt-1 min-h-20"}
                      maxLength={4000}
                      value={values[f.key]}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    />
                  ) : (
                    <Input
                      aria-label={f.label}
                      type={f.url ? "url" : "text"}
                      required={f.key === "nome"}
                      minLength={f.key === "nome" ? 2 : undefined}
                      maxLength={f.key === "nome" ? 150 : 4000}
                      className={inputClass + " mt-1"}
                      value={values[f.key]}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      placeholder={f.url ? "https://" : ""}
                    />
                  )}
                </label>
              ))}
          </div>
        </fieldset>
      ))}
      <div className="hml-form-actions flex justify-end gap-2">
        {editable && (
          <p role="status" className="mr-auto text-xs text-muted-foreground">
            {pending
              ? "Salvando alterações…"
              : Object.keys(patch).length
                ? "Alterações não salvas"
                : "Nenhuma alteração pendente"}
          </p>
        )}
        {onCancel && (
          <button type="button" disabled={pending} className={secondaryClass} onClick={onCancel}>
            Cancelar
          </button>
        )}
        {editable && (
          <button className={actionClass} disabled={pending || !Object.keys(patch).length}>
            {pending ? "Salvando…" : creating ? "Cadastrar empreendimento" : "Salvar alterações"}
          </button>
        )}
      </div>
    </form>
  );
}

