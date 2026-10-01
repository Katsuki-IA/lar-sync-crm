import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getNegotiationConfig, saveNegotiationConfig } from "@/lib/negotiation.functions";
import { type NegotiationMode } from "@/lib/negotiation";
import { NegotiationSelect } from "@/components/negotiation-select";
import { Button } from "@/components/ui/button";

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
