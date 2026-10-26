import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { commercialSettings } from "@/lib/commercial-settings.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ConfigHeader, ConfigSection } from "@/components/config-presentation";
import { inputClass } from "./modules";

type Definition = {
  id: number;
  nome: string;
  ativo: boolean;
  ordem: number;
  hub_revision: number;
  id_funnel?: number;
  cor?: string;
};
type Destination = { funnel_id: number; stage_id: number };
const situations = {
  unqualified: "Não qualificado / entrada padrão",
  qualified: "Qualificado",
  visit: "Visita agendada",
  lost: "Perdido",
  without_whatsapp: "Sem WhatsApp",
  blocked_send: "Bloqueio de envio",
};
type Situation = keyof typeof situations;
type Settings = {
  enabled: boolean;
  revision: number;
  destinations: Partial<Record<Situation, Destination>>;
};
type Config = {
  installed: boolean;
  funnels: Definition[];
  stages: Definition[];
  settings: Settings;
};
export function CommercialSettings({
  companyId,
  destinationOnly = false,
}: {
  companyId: number;
  destinationOnly?: boolean;
}) {
  const call = useServerFn(commercialSettings),
    qc = useQueryClient();
  const q = useQuery({
    queryKey: ["commercial-settings", companyId],
    queryFn: async () => (await call({ data: { action: "read", companyId } })) as Config,
  });
  const [editing, setEditing] = useState<
    (Partial<Definition> & { kind: "stage" | "funnel"; replacement_id?: number | null }) | null
  >(null);
  const [draft, setDraft] = useState<Settings | null>(null),
    [busy, setBusy] = useState(false);
  const cfg = q.data,
    settings = draft ?? cfg?.settings;
  async function refresh() {
    setEditing(null);
    setDraft(null);
    await qc.invalidateQueries({ queryKey: ["commercial-settings", companyId] });
    await qc.invalidateQueries({ queryKey: ["commercial-workspace"] });
    await qc.invalidateQueries({ queryKey: ["sales-queues"] });
  }
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast.success("Configuração salva");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }
  if (q.isPending) return <p>Carregando configuração comercial…</p>;
  if (q.isError)
    return (
      <p role="alert">
        Não foi possível carregar. <Button onClick={() => q.refetch()}>Tentar novamente</Button>
      </p>
    );
  if (!cfg?.installed)
    return (
      <ConfigSection>
        <h2 className="font-semibold">
          {destinationOnly ? "Destino interno do CRM" : "Funil comercial"}
        </h2>
        <p>
          Configuração ainda não instalada neste ambiente. Os envios existentes permanecem como
          estão.
        </p>
      </ConfigSection>
    );
  if (destinationOnly && settings)
    return (
      <ConfigSection>
        <h2 className="font-semibold">Destino dos leads: CRM Katsuki interno</h2>
        <p className="text-sm text-muted-foreground">
          Ao ativar, os próximos pedidos de envio criam oportunidades neste HUB, sem chamar o CRM
          Katsuki externo. Os gatilhos e prazos de envio continuam nas regras abaixo. Não importa
          leads antigos nem move oportunidades existentes. As filas passam a distribuir as
          oportunidades criadas por este envio.
        </p>
        <label className="flex gap-2">
          <input
            type="checkbox"
            disabled={busy}
            checked={settings.enabled}
            onChange={(e) => setDraft({ ...settings, enabled: e.target.checked })}
          />
          Usar CRM Katsuki interno para esta empresa
        </label>
        <p className="text-sm">
          Situações sem destino próprio usam a entrada padrão. Renomear etapas preserva estes
          vínculos.
        </p>
        <div className="space-y-4">
          {Object.entries(situations).map(([key, label]) => {
            const k = key as Situation,
              d = settings.destinations[k];
            return (
              <div key={k} className="grid gap-2 md:grid-cols-3">
                <span className="text-sm font-medium">{label}</span>
                <select
                  aria-label={`Funil: ${label}`}
                  className={inputClass}
                  disabled={busy}
                  value={d?.funnel_id ?? ""}
                  onChange={(e) => {
                    const destinations = { ...settings.destinations };
                    delete destinations[k];
                    if (e.target.value) {
                      const f = Number(e.target.value),
                        s = cfg.stages.find((s) => s.id_funnel === f && s.ativo);
                      if (!s) {
                        toast.error("Adicione uma etapa ativa neste funil");
                        return;
                      }
                      destinations[k] = { funnel_id: f, stage_id: s.id };
                    }
                    setDraft({ ...settings, destinations });
                  }}
                >
                  <option value="">
                    {k === "unqualified" ? "Selecione o funil" : "Usar entrada padrão"}
                  </option>
                  {cfg.funnels
                    .filter((f) => f.ativo)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                      </option>
                    ))}
                </select>
                <select
                  aria-label={`Etapa: ${label}`}
                  className={inputClass}
                  disabled={busy || !d}
                  value={d?.stage_id ?? ""}
                  onChange={(e) =>
                    d &&
                    setDraft({
                      ...settings,
                      destinations: {
                        ...settings.destinations,
                        [k]: { ...d, stage_id: Number(e.target.value) },
                      },
                    })
                  }
                >
                  <option value="" disabled>
                    Selecione a etapa
                  </option>
                  {cfg.stages
                    .filter((s) => s.ativo && s.id_funnel === d?.funnel_id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome}
                      </option>
                    ))}
                </select>
              </div>
            );
          })}
        </div>
        <Button
          disabled={busy}
          onClick={() =>
            run(() =>
              call({
                data: {
                  action: "destination",
                  companyId,
                  revision: settings.revision,
                  enabled: settings.enabled,
                  destinations: settings.destinations,
                },
              }),
            )
          }
        >
          {busy ? "Salvando…" : "Salvar destino interno"}
        </Button>
      </ConfigSection>
    );
  return (
    <div className="config-page space-y-6">
      <ConfigHeader
        title="Funil comercial"
        description="Personalize os funis e etapas de vendas desta empresa. O Atendimento IA mantém suas próprias etapas."
      />
      <Button
        onClick={() =>
          setEditing({ kind: "funnel", nome: "", ordem: cfg.funnels.length + 1, ativo: true })
        }
      >
        Novo funil
      </Button>
      {cfg.funnels.map((f) => (
        <ConfigSection key={f.id}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              {f.nome}
              {!f.ativo ? " · Inativo" : ""}
            </h2>
            <Button variant="outline" onClick={() => setEditing({ ...f, kind: "funnel" })}>
              Editar funil
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Posição</th>
                  <th>Situação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {cfg.stages
                  .filter((s) => s.id_funnel === f.id)
                  .map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="py-3">{s.nome}</td>
                      <td>{s.ordem}</td>
                      <td>{s.ativo ? "Ativa" : "Inativa"}</td>
                      <td>
                        <Button
                          variant="outline"
                          onClick={() => setEditing({ ...s, kind: "stage" })}
                        >
                          Editar
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {f.ativo && (
            <Button
              variant="outline"
              onClick={() =>
                setEditing({
                  kind: "stage",
                  nome: "",
                  ativo: true,
                  ordem: cfg.stages.filter((s) => s.id_funnel === f.id).length + 1,
                  id_funnel: f.id,
                  cor: "#c44f1c",
                })
              }
            >
              Adicionar etapa
            </Button>
          )}
        </ConfigSection>
      ))}
      {editing && (
        <Dialog open onOpenChange={(open) => !open && !busy && setEditing(null)}>
          <DialogContent className="config-dialog">
            <DialogHeader>
              <DialogTitle>
                {editing.id ? "Editar" : "Criar"} {editing.kind === "stage" ? "etapa" : "funil"}
              </DialogTitle>
              <DialogDescription>
                As mudanças valem apenas para esta empresa. Desativar preserva o histórico.
              </DialogDescription>
            </DialogHeader>
            <form
              className="config-form space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                run(() =>
                  call({
                    data: {
                      action: "definition",
                      companyId,
                      kind: editing.kind,
                      id: editing.id ?? null,
                      revision: editing.hub_revision ?? null,
                      values: {
                        nome: editing.nome ?? "",
                        ordem: editing.ordem ?? 0,
                        ativo: editing.ativo ?? true,
                        ...(editing.kind === "stage"
                          ? {
                              id_funnel: editing.id_funnel!,
                              cor: editing.cor ?? "#c44f1c",
                              replacement_id: editing.replacement_id ?? null,
                            }
                          : {}),
                      },
                    },
                  }),
                );
              }}
            >
              <label className="block">
                Nome
                <input
                  className={inputClass}
                  required
                  minLength={2}
                  maxLength={120}
                  disabled={busy}
                  value={editing.nome}
                  onChange={(e) => setEditing({ ...editing, nome: e.target.value })}
                />
              </label>
              <label className="block">
                Posição
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  max={10000}
                  disabled={busy}
                  value={editing.ordem}
                  onChange={(e) => setEditing({ ...editing, ordem: Number(e.target.value) })}
                />
              </label>
              {editing.kind === "stage" && (
                <label className="block">
                  Cor
                  <input
                    type="color"
                    disabled={busy}
                    value={editing.cor}
                    onChange={(e) => setEditing({ ...editing, cor: e.target.value })}
                  />
                </label>
              )}
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={editing.ativo}
                  onChange={(e) => setEditing({ ...editing, ativo: e.target.checked })}
                />
                Ativo
              </label>
              {editing.kind === "stage" && !editing.ativo && editing.id && (
                <label className="block">
                  Etapa substituta para oportunidades e regras
                  <select
                    className={inputClass}
                    disabled={busy}
                    value={editing.replacement_id ?? ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        replacement_id: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  >
                    <option value="">Sem substituição (apenas se não estiver em uso)</option>
                    {cfg.stages
                      .filter(
                        (s) => s.ativo && s.id_funnel === editing.id_funnel && s.id !== editing.id,
                      )
                      .map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.nome}
                        </option>
                      ))}
                  </select>
                  <span className="text-xs">
                    As oportunidades serão movidas para a substituta ao salvar.
                  </span>
                </label>
              )}
              <Button disabled={busy} type="submit">
                {busy ? "Salvando…" : "Salvar"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
