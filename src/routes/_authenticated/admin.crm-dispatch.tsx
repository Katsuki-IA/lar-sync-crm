import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { listEmpresas, getCrmDispatchSettings, saveCrmDispatchSettings } from "@/lib/admin.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin/crm-dispatch")({
  component: AdminCrmDispatchPage,
});

type Empresa = {
  id: number;
  nome: string | null;
};

type StageOption = {
  id: number;
  nome: string;
  ordem: number;
};

const EMPTY_VALUE = "__none__";

function AdminCrmDispatchPage() {
  const qc = useQueryClient();
  const listEmpresasFn = useServerFn(listEmpresas);
  const getSettingsFn = useServerFn(getCrmDispatchSettings);
  const saveSettingsFn = useServerFn(saveCrmDispatchSettings);

  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [withoutContactStageId, setWithoutContactStageId] = useState<string>(EMPTY_VALUE);
  const [withContactStageId, setWithContactStageId] = useState<string>(EMPTY_VALUE);

  const { data: companies = [], isLoading: companiesLoading } = useQuery({
    queryKey: ["admin_empresas"],
    queryFn: () => listEmpresasFn(),
  });

  useEffect(() => {
    if (!selectedCompanyId && companies.length > 0) {
      setSelectedCompanyId(String((companies[0] as Empresa).id));
    }
  }, [companies, selectedCompanyId]);

  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: ["admin_crm_dispatch_settings", selectedCompanyId],
    enabled: !!selectedCompanyId,
    queryFn: () => getSettingsFn({ data: { id_empresa: Number(selectedCompanyId) } }),
  });

  useEffect(() => {
    if (!configData) return;
    setWithoutContactStageId(
      configData.settings.stage_without_contact_id != null
        ? String(configData.settings.stage_without_contact_id)
        : EMPTY_VALUE,
    );
    setWithContactStageId(
      configData.settings.stage_with_contact_id != null
        ? String(configData.settings.stage_with_contact_id)
        : EMPTY_VALUE,
    );
  }, [configData]);

  const selectedCompany = useMemo(
    () => companies.find((company: Empresa) => String(company.id) === selectedCompanyId) ?? null,
    [companies, selectedCompanyId],
  );

  const saveMutation = useMutation({
    mutationFn: async () =>
      saveSettingsFn({
        data: {
          id_empresa: Number(selectedCompanyId),
          stage_without_contact_id:
            withoutContactStageId === EMPTY_VALUE ? null : Number(withoutContactStageId),
          stage_with_contact_id:
            withContactStageId === EMPTY_VALUE ? null : Number(withContactStageId),
        },
      }),
    onSuccess: async () => {
      toast.success("Configuração de envio ao CRM salva");
      await qc.invalidateQueries({ queryKey: ["admin_crm_dispatch_settings", selectedCompanyId] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? "Falha ao salvar configuração");
    },
  });

  const stages = (configData?.stages ?? []) as StageOption[];
  const isLoading = companiesLoading || (!!selectedCompanyId && configLoading);

  return (
    <Card className="p-4 space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-medium">Envio ao CRM</h2>
        <p className="text-sm text-muted-foreground">
          Defina em qual etapa o lead passa a ficar elegível para envio ao CRM externo da empresa.
          Neste passo, a configuração apenas registra a regra; o envio em si ainda não é executado.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[320px_1fr] md:items-start">
        <div className="space-y-1.5">
          <Label htmlFor="dispatch-company">Empresa</Label>
          <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
            <SelectTrigger id="dispatch-company" className="bg-white">
              <SelectValue placeholder="Selecionar empresa" />
            </SelectTrigger>
            <SelectContent>
              {companies.map((company: Empresa) => (
                <SelectItem key={company.id} value={String(company.id)}>
                  {company.nome ?? `Empresa ${company.id}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
          {selectedCompany ? (
            <>
              Configuração atual para <span className="font-medium text-foreground">{selectedCompany.nome ?? `Empresa ${selectedCompany.id}`}</span>.
              As opções abaixo usam os IDs locais das etapas desta empresa.
            </>
          ) : (
            "Selecione uma empresa para configurar."
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border p-4">
          <div className="space-y-1">
            <h3 className="font-medium">Lead sem contato</h3>
            <p className="text-sm text-muted-foreground">
              Escolha a etapa em que um lead sem interação registrada deve ser considerado pronto para envio ao CRM.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="without-contact-stage">Etapa de envio</Label>
            <Select value={withoutContactStageId} onValueChange={setWithoutContactStageId} disabled={isLoading}>
              <SelectTrigger id="without-contact-stage" className="bg-white">
                <SelectValue placeholder="Selecionar etapa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EMPTY_VALUE}>Não configurado</SelectItem>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={String(stage.id)}>
                    {stage.nome} (ID #{stage.id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-4">
          <div className="space-y-1">
            <h3 className="font-medium">Lead com contato</h3>
            <p className="text-sm text-muted-foreground">
              Escolha a etapa em que um lead que já interagiu deve ser considerado pronto para envio ao CRM.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="with-contact-stage">Etapa de envio</Label>
            <Select value={withContactStageId} onValueChange={setWithContactStageId} disabled={isLoading}>
              <SelectTrigger id="with-contact-stage" className="bg-white">
                <SelectValue placeholder="Selecionar etapa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EMPTY_VALUE}>Não configurado</SelectItem>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={String(stage.id)}>
                    {stage.nome} (ID #{stage.id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border p-4">
        <div className="text-sm text-muted-foreground">
          Etapas permitidas nesta configuração: Follow Up 1, Follow Up 2, Follow Up 3, Follow Up 4 e Visita Agendada.
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!selectedCompanyId || saveMutation.isPending || isLoading}
        >
          {saveMutation.isPending ? "Salvando..." : "Salvar configuração"}
        </Button>
      </div>
    </Card>
  );
}
