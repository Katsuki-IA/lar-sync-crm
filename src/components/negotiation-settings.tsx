import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getNegotiationConfig,
  saveNegotiationConfig,
  saveC2sQueues,
} from "@/lib/negotiation.functions";
import { type NegotiationMode } from "@/lib/negotiation";
import { NegotiationSelect } from "@/components/negotiation-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NegotiationSettings({ companyId }: { companyId: number }) {
  const getConfig = useServerFn(getNegotiationConfig);
  const { data, isLoading, error } = useQuery({
    queryKey: ["negotiation-config", companyId],
    queryFn: () => getConfig({ data: { companyId } }),
  });
  if (isLoading) return <p>Carregando configurações…</p>;
  if (error || !data)
    return (
      <p className="text-destructive">
        {error?.message ?? "Não foi possível carregar as configurações."}
      </p>
    );
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Configure quais operações a empresa e cada empreendimento atendem. Venda é o padrão.
      </p>
      <ModeRow
        key={`company-${data.company.modalidade_negociacao}`}
        companyId={companyId}
        name={data.company.nome ?? "Empresa"}
        mode={data.company.modalidade_negociacao as NegotiationMode}
      />
      <h3 className="font-medium">Empreendimentos</h3>
      {data.projects.length ? (
        data.projects.map((project) => (
          <ModeRow
            key={`${project.id}-${project.modalidade_negociacao}`}
            companyId={companyId}
            projectId={project.id}
            name={project.nome}
            mode={project.modalidade_negociacao as NegotiationMode}
          />
        ))
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum empreendimento cadastrado.</p>
      )}
      <h3 className="font-medium">Filas de atendimento C2S</h3>
      <p className="text-sm text-muted-foreground">
        O empreendimento tem prioridade. Campos vazios usam a fila da empresa. Venda e locação usam
        filas diferentes conforme a intenção do lead; Ambos precisa de intenção definida.
      </p>
      <QueueRow
        key={`queues-company-${companyId}-${data.company.c2s_fila_venda_id}-${data.company.c2s_fila_locacao_id}`}
        companyId={companyId}
        name="Padrão da empresa"
        saleQueue={data.company.c2s_fila_venda_id}
        rentalQueue={data.company.c2s_fila_locacao_id}
      />
      {data.projects.map((project) => (
        <QueueRow
          key={`queues-${companyId}-${project.id}-${project.c2s_fila_venda_id}-${project.c2s_fila_locacao_id}`}
          companyId={companyId}
          projectId={project.id}
          name={project.nome}
          saleQueue={project.c2s_fila_venda_id}
          rentalQueue={project.c2s_fila_locacao_id}
        />
      ))}
    </div>
  );
}

function QueueRow({
  companyId,
  projectId,
  name,
  saleQueue,
  rentalQueue,
}: {
  companyId: number;
  projectId?: number;
  name: string;
  saleQueue: number | null;
  rentalQueue: number | null;
}) {
  const [sale, setSale] = useState(String(saleQueue ?? ""));
  const [rental, setRental] = useState(String(rentalQueue ?? ""));
  const [saving, setSaving] = useState(false);
  const save = useServerFn(saveC2sQueues);
  const qc = useQueryClient();
  async function submit() {
    if (
      [sale, rental].some(
        (value) =>
          value &&
          (!/^\d+$/.test(value) || Number(value) <= 0 || !Number.isSafeInteger(Number(value))),
      )
    ) {
      toast.error("Informe um ID de fila válido");
      return;
    }
    setSaving(true);
    try {
      await save({
        data: {
          companyId,
          projectId,
          saleQueue: sale ? Number(sale) : null,
          rentalQueue: rental ? Number(rental) : null,
        },
      });
      await qc.invalidateQueries({ queryKey: ["negotiation-config", companyId] });
      toast.success("Filas C2S salvas");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar filas");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h4 className="font-medium">{name}</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          Fila C2S: Venda
          <Input
            aria-label={`Fila C2S de venda: ${name}`}
            inputMode="numeric"
            value={sale}
            onChange={(event) => setSale(event.target.value)}
            disabled={saving}
            placeholder={projectId ? "Usar padrão da empresa" : "ID da fila de venda"}
          />
        </label>
        <label className="space-y-1 text-sm">
          Fila C2S: Locação
          <Input
            aria-label={`Fila C2S de locação: ${name}`}
            inputMode="numeric"
            value={rental}
            onChange={(event) => setRental(event.target.value)}
            disabled={saving}
            placeholder={projectId ? "Usar padrão da empresa" : "ID da fila de locação"}
          />
        </label>
      </div>
      <Button
        onClick={submit}
        disabled={
          saving || (sale === String(saleQueue ?? "") && rental === String(rentalQueue ?? ""))
        }
      >
        {saving ? "Salvando…" : "Salvar filas"}
      </Button>
    </div>
  );
}

function ModeRow({
  companyId,
  projectId,
  name,
  mode,
}: {
  companyId: number;
  projectId?: number;
  name: string;
  mode: NegotiationMode;
}) {
  const [value, setValue] = useState(mode);
  const [saving, setSaving] = useState(false);
  const save = useServerFn(saveNegotiationConfig);
  const qc = useQueryClient();
  const id = `negotiation-${projectId ?? "company"}`;
  async function submit() {
    setSaving(true);
    try {
      await save({ data: { companyId, projectId, mode: value } });
      await qc.invalidateQueries({ queryKey: ["negotiation-config", companyId] });
      toast.success("Modalidade salva");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
      <div className="min-w-56 flex-1 space-y-2">
        <label htmlFor={id} className="text-sm font-medium">
          {projectId ? name : `Empresa: ${name}`}
        </label>
        <NegotiationSelect id={id} value={value} onChange={setValue} disabled={saving} />
      </div>
      <Button onClick={submit} disabled={saving || value === mode}>
        {saving ? "Salvando…" : "Salvar"}
      </Button>
    </div>
  );
}
