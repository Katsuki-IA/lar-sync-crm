import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Config = {
  enabled: boolean;
  field_id: number | null;
  field_name: string;
  mappings: Record<string, number>;
  unknown_policy: "undefined" | "block";
  auto_create_options: boolean;
  sync_interest: boolean;
  last_error: string | null;
  account_matches: boolean;
};
type Status = {
  config: Config | null;
  projects: { id: number; nome: string }[];
  sync: { lead_id: number; status: string; last_error: string | null; updated_at: string }[];
};
type Field = { id: number; name: string; enums: { id: number; value: string }[] | null };
async function callKommo<T>(
  companyId: number,
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("kommo-project-config", {
    body: { ...body, companyId, action },
  });
  if (error) {
    let message = "Não foi possível consultar a configuração Kommo.";
    if ("context" in error && error.context instanceof Response) {
      try {
        message = (await error.context.json()).error ?? message;
      } catch {
        /* use fallback */
      }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
export function KommoProjectSettings({ companyId }: { companyId: number }) {
  const status = useQuery({
    queryKey: ["kommo-project-config", companyId],
    queryFn: () => callKommo<Status>(companyId, "status"),
  });
  if (status.isLoading) return <p>Carregando identificação de empreendimentos…</p>;
  if (status.error || !status.data)
    return (
      <div className="space-y-2">
        <p className="text-destructive">{status.error?.message ?? "Configuração indisponível."}</p>
        <Button variant="outline" onClick={() => status.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  return (
    <ProjectForm
      key={`${companyId}-${status.dataUpdatedAt}`}
      companyId={companyId}
      data={status.data}
    />
  );
}
function ProjectForm({ companyId, data }: { companyId: number; data: Status }) {
  const qc = useQueryClient();
  const [field, setField] = useState(
    data.config?.field_id ? String(data.config.field_id) : "create",
  );
  const [mappings, setMappings] = useState<Record<string, number>>(data.config?.mappings ?? {});
  const [unknownPolicy, setUnknownPolicy] = useState(data.config?.unknown_policy ?? "undefined");
  const [autoOptions, setAutoOptions] = useState(data.config?.auto_create_options ?? true);
  const [syncInterest, setSyncInterest] = useState(data.config?.sync_interest ?? true);
  const [busy, setBusy] = useState(false);
  const fields = useQuery({
    queryKey: ["kommo-project-fields", companyId],
    queryFn: () => callKommo<{ fields: Field[] }>(companyId, "fields"),
    staleTime: 60000,
  });
  const selected = fields.data?.fields.find((f) => String(f.id) === field);
  async function submit(action: "configure" | "disable" | "sync") {
    setBusy(true);
    try {
      await callKommo(companyId, action, {
        createStandard: field === "create",
        fieldId: field === "create" ? null : Number(field),
        mappings: field === "create" ? {} : mappings,
        unknownPolicy,
        autoCreateOptions: autoOptions,
        syncInterest,
      });
      toast.success(
        action === "disable"
          ? "Identificação automática desativada"
          : "Mapeamento de empreendimentos salvo no Kommo",
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["kommo-project-config", companyId] }),
        qc.invalidateQueries({ queryKey: ["kommo-project-fields", companyId] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Identifique cada lead no Kommo pelo empreendimento de interesse. O interesse atual do
        atendimento tem prioridade; quando ele não estiver definido, usamos o empreendimento de
        origem.
      </p>
      <p className="text-sm font-medium">
        {data.config?.enabled
          ? "Identificação automática ativa"
          : "Identificação automática ainda não ativada"}
      </p>
      {data.config?.last_error && (
        <p role="alert" className="text-sm text-destructive">
          {data.config.last_error}
        </p>
      )}
      {data.config && !data.config.account_matches && (
        <p role="alert" className="text-sm text-destructive">
          A conta Kommo foi alterada. O mapeamento precisa ser revisado antes de continuar.
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor={`kommo-field-${companyId}`}>Campo do lead no Kommo</Label>
        <Select
          value={field}
          disabled={busy}
          onValueChange={(value) => {
            setField(value);
            setMappings(
              value === String(data.config?.field_id) ? (data.config?.mappings ?? {}) : {},
            );
          }}
        >
          <SelectTrigger id={`kommo-field-${companyId}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="create">
              Criar ou usar o campo padrão: Empreendimento de interesse
            </SelectItem>
            {fields.data?.fields.map((f) => (
              <SelectItem key={f.id} value={String(f.id)}>
                {f.name}
              </SelectItem>
            ))}
            {data.config?.field_id &&
              !fields.data?.fields.some((f) => f.id === data.config?.field_id) && (
                <SelectItem value={String(data.config.field_id)}>
                  {data.config.field_name}
                </SelectItem>
              )}
          </SelectContent>
        </Select>
        {fields.error && <p className="text-sm text-destructive">{fields.error.message}</p>}
        <p className="text-xs text-muted-foreground">
          Criar campos e opções exige uma conexão Kommo com permissão de administrador.
        </p>
      </div>
      <div className="space-y-3">
        <h4 className="font-medium">Empreendimentos</h4>
        {data.projects.length === 0 && (
          <p className="text-sm">Cadastre um empreendimento para começar.</p>
        )}
        {data.projects.map((p) => (
          <div key={p.id} className="grid items-center gap-2 sm:grid-cols-2">
            <Label htmlFor={`kommo-project-${p.id}`}>{p.nome}</Label>
            {field === "create" ? (
              <span className="text-sm text-muted-foreground">Opção: {p.nome}</span>
            ) : (
              <Select
                disabled={busy || !selected}
                value={String(mappings[String(p.id)] ?? "auto")}
                onValueChange={(value) =>
                  setMappings((previous) => {
                    const next = { ...previous };
                    if (value === "auto") delete next[String(p.id)];
                    else next[String(p.id)] = Number(value);
                    return next;
                  })
                }
              >
                <SelectTrigger id={`kommo-project-${p.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Identificar pelo nome</SelectItem>
                  {selected?.enums?.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`kommo-unknown-${companyId}`}>
          Quando o lead não tiver empreendimento definido
        </Label>
        <Select
          disabled={busy}
          value={unknownPolicy}
          onValueChange={(value) => setUnknownPolicy(value as "undefined" | "block")}
        >
          <SelectTrigger id={`kommo-unknown-${companyId}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="undefined">Enviar como Não definido</SelectItem>
            <SelectItem value="block">Aguardar definição antes de enviar</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-3">
        <Switch
          id={`kommo-options-${companyId}`}
          disabled={busy}
          checked={autoOptions}
          onCheckedChange={setAutoOptions}
        />
        <Label htmlFor={`kommo-options-${companyId}`}>
          Criar opções automaticamente para novos empreendimentos
        </Label>
      </div>
      <div className="flex items-center gap-3">
        <Switch
          id={`kommo-interest-${companyId}`}
          disabled={busy}
          checked={syncInterest}
          onCheckedChange={setSyncInterest}
        />
        <Label htmlFor={`kommo-interest-${companyId}`}>
          Atualizar o Kommo quando o interesse do lead mudar
        </Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Leads com envio confirmado pelo Hub terão o campo vazio preenchido gradualmente. Alterações
        feitas no Kommo serão sinalizadas para revisão. A sincronização é periódica.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={
            busy || !data.projects.length || (data.config !== null && !data.config.account_matches)
          }
          onClick={() => submit("configure")}
        >
          {busy
            ? "Processando…"
            : data.config?.enabled
              ? "Salvar identificação"
              : "Ativar identificação"}
        </Button>
        {data.config?.enabled && (
          <Button variant="outline" disabled={busy} onClick={() => submit("sync")}>
            Sincronizar opções
          </Button>
        )}
        {data.config?.enabled && (
          <Button variant="ghost" disabled={busy} onClick={() => submit("disable")}>
            Desativar
          </Button>
        )}
      </div>
      {data.sync.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <h4 className="font-medium">Conferência dos leads enviados</h4>
          <p className="text-sm text-muted-foreground">
            {data.sync.filter((s) => s.status === "synced").length} sincronizados ·{" "}
            {data.sync.filter((s) => s.status === "pending").length} pendentes ·{" "}
            {data.sync.filter((s) => ["failed", "conflict"].includes(s.status)).length} para revisão
            (até 100 registros recentes)
          </p>
          {data.sync
            .filter((s) => s.last_error)
            .slice(0, 10)
            .map((s) => (
              <p key={s.lead_id} className="text-sm">
                <a className="underline" href={`/leads/${s.lead_id}`}>
                  Lead #{s.lead_id}
                </a>
                : {s.last_error}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
