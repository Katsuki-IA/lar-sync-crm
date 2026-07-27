import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { listCrmDispatchEmpresas, getCrmDispatchSettings, saveCrmDispatchSettings } from "@/lib/admin.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type EmpreendimentoOption = {
  id: number;
  nome: string | null;
};

type ExternalStageOverride = {
  external_stage_blocked_send_id: string;
  external_stage_qualified_id: string;
  external_stage_unqualified_id: string;
  external_stage_visit_scheduled_id: string;
  external_stage_lost_id: string;
  external_stage_without_whatsapp_id: string;
};

const EMPTY_VALUE = "__none__";
const WITHOUT_CONTACT_STAGE_NAMES = new Set(["Follow Up 1", "Follow Up 2", "Follow Up 3", "Follow Up 4"]);

function AdminCrmDispatchPage() {
  const qc = useQueryClient();
  const listCrmDispatchEmpresasFn = useServerFn(listCrmDispatchEmpresas);
  const getSettingsFn = useServerFn(getCrmDispatchSettings);
  const saveSettingsFn = useServerFn(saveCrmDispatchSettings);

  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [withoutContactStageId, setWithoutContactStageId] = useState<string>(EMPTY_VALUE);
  const [withContactStageId, setWithContactStageId] = useState<string>(EMPTY_VALUE);
  const [blockedSendExternalStageId, setBlockedSendExternalStageId] = useState("");
  const [qualifiedExternalStageId, setQualifiedExternalStageId] = useState("");
  const [unqualifiedExternalStageId, setUnqualifiedExternalStageId] = useState("");
  const [visitScheduledExternalStageId, setVisitScheduledExternalStageId] = useState("");
  const [lostExternalStageId, setLostExternalStageId] = useState("");
  const [withoutWhatsappExternalStageId, setWithoutWhatsappExternalStageId] = useState("");
  const [stageOverrides, setStageOverrides] = useState<Record<number, ExternalStageOverride>>({});

  const { data: companies = [], isLoading: companiesLoading } = useQuery({
    queryKey: ["admin_crm_dispatch_empresas"],
    queryFn: () => listCrmDispatchEmpresasFn(),
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
    setBlockedSendExternalStageId(configData.settings.external_stage_blocked_send_id ?? "");
    setQualifiedExternalStageId(configData.settings.external_stage_qualified_id ?? "");
    setUnqualifiedExternalStageId(configData.settings.external_stage_unqualified_id ?? "");
    setVisitScheduledExternalStageId(configData.settings.external_stage_visit_scheduled_id ?? "");
    setLostExternalStageId(configData.settings.external_stage_lost_id ?? "");
    setWithoutWhatsappExternalStageId(configData.settings.external_stage_without_whatsapp_id ?? "");
    setStageOverrides(
      Object.fromEntries(
        (configData.stage_overrides ?? []).map((override: any) => [
          Number(override.id_empreendimento),
          {
            external_stage_blocked_send_id: override.external_stage_blocked_send_id ?? "",
            external_stage_qualified_id: override.external_stage_qualified_id ?? "",
            external_stage_unqualified_id: override.external_stage_unqualified_id ?? "",
            external_stage_visit_scheduled_id: override.external_stage_visit_scheduled_id ?? "",
            external_stage_lost_id: override.external_stage_lost_id ?? "",
            external_stage_without_whatsapp_id: override.external_stage_without_whatsapp_id ?? "",
          },
        ]),
      ),
    );
  }, [configData]);

  const updateStageOverride = (
    idEmpreendimento: number,
    field: keyof ExternalStageOverride,
    value: string,
  ) => {
    setStageOverrides((current) => ({
      ...current,
      [idEmpreendimento]: {
        external_stage_blocked_send_id: "",
        external_stage_qualified_id: "",
        external_stage_unqualified_id: "",
        external_stage_visit_scheduled_id: "",
        external_stage_lost_id: "",
        external_stage_without_whatsapp_id: "",
        ...current[idEmpreendimento],
        [field]: value,
      },
    }));
  };

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
          external_stage_blocked_send_id: blockedSendExternalStageId.trim() || null,
          external_stage_qualified_id: qualifiedExternalStageId.trim() || null,
          external_stage_unqualified_id: unqualifiedExternalStageId.trim() || null,
          external_stage_visit_scheduled_id: visitScheduledExternalStageId.trim() || null,
          external_stage_lost_id: lostExternalStageId.trim() || null,
          external_stage_without_whatsapp_id: withoutWhatsappExternalStageId.trim() || null,
          stage_overrides: ((configData?.empreendimentos ?? []) as EmpreendimentoOption[]).map((project) => {
            const override = stageOverrides[project.id];
            return {
              id_empreendimento: project.id,
              external_stage_blocked_send_id: override?.external_stage_blocked_send_id.trim() || null,
              external_stage_qualified_id: override?.external_stage_qualified_id.trim() || null,
              external_stage_unqualified_id: override?.external_stage_unqualified_id.trim() || null,
              external_stage_visit_scheduled_id: override?.external_stage_visit_scheduled_id.trim() || null,
              external_stage_lost_id: override?.external_stage_lost_id.trim() || null,
              external_stage_without_whatsapp_id: override?.external_stage_without_whatsapp_id.trim() || null,
            };
          }),
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
  const empreendimentos = (configData?.empreendimentos ?? []) as EmpreendimentoOption[];
  const withoutContactStages = stages.filter((stage) => WITHOUT_CONTACT_STAGE_NAMES.has(stage.nome));
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

        {!selectedCompany && (
          <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
            Selecione uma empresa para configurar.
          </div>
        )}
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
                {withoutContactStages.map((stage) => (
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
        <div className="w-full space-y-4">
          <div className="space-y-1">
            <h3 className="font-medium">Etapas Padrão</h3>
            <p className="text-sm text-muted-foreground">
              Configure os IDs externos usados em cada situação; campos vazios usam o ID Não qualificado como fallback.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="external-stage-unqualified">ID Não qualificado</Label>
              <Input
                id="external-stage-unqualified"
                value={unqualifiedExternalStageId}
                onChange={(event) => setUnqualifiedExternalStageId(event.target.value)}
                placeholder="Ex.: 23456"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="external-stage-qualified">ID Qualificado</Label>
              <Input
                id="external-stage-qualified"
                value={qualifiedExternalStageId}
                onChange={(event) => setQualifiedExternalStageId(event.target.value)}
                placeholder="Ex.: 34567"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="external-stage-visit">ID Visita agendada</Label>
              <Input
                id="external-stage-visit"
                value={visitScheduledExternalStageId}
                onChange={(event) => setVisitScheduledExternalStageId(event.target.value)}
                placeholder="Ex.: 67890"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="external-stage-lost">ID Perdido</Label>
              <Input
                id="external-stage-lost"
                value={lostExternalStageId}
                onChange={(event) => setLostExternalStageId(event.target.value)}
                placeholder="Ex.: 99999"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="external-stage-without-whatsapp">ID Sem WhatsApp</Label>
              <Input
                id="external-stage-without-whatsapp"
                value={withoutWhatsappExternalStageId}
                onChange={(event) => setWithoutWhatsappExternalStageId(event.target.value)}
                placeholder="Ex.: 88888"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="external-stage-blocked-send">ID Bloqueio Envio</Label>
              <Input
                id="external-stage-blocked-send"
                value={blockedSendExternalStageId}
                onChange={(event) => setBlockedSendExternalStageId(event.target.value)}
                placeholder="Ex.: 12345"
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="space-y-4 border-t border-dashed pt-4">
            <div className="space-y-1">
              <h3 className="font-medium">Etapas por empreendimento</h3>
              <p className="text-sm text-muted-foreground">
                Opcional. Preencha somente quando esse empreendimento usar IDs diferentes no CRM externo. Campos vazios mantêm o padrão da empresa acima.
              </p>
            </div>

            {empreendimentos.length ? (
              <div className="space-y-3">
                {empreendimentos.map((project) => {
                  const override = stageOverrides[project.id];
                  return (
                    <div key={project.id} className="space-y-3 rounded-lg border border-border p-4">
                      <h4 className="font-medium">{project.nome ?? `Empreendimento ${project.id}`}</h4>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor={`project-${project.id}-unqualified`}>ID: Não qualificado</Label>
                          <Input
                            id={`project-${project.id}-unqualified`}
                            value={override?.external_stage_unqualified_id ?? ""}
                            onChange={(event) => updateStageOverride(project.id, "external_stage_unqualified_id", event.target.value)}
                            placeholder={unqualifiedExternalStageId || "Usar padrão da empresa"}
                            disabled={isLoading}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`project-${project.id}-qualified`}>ID: Qualificado</Label>
                          <Input
                            id={`project-${project.id}-qualified`}
                            value={override?.external_stage_qualified_id ?? ""}
                            onChange={(event) => updateStageOverride(project.id, "external_stage_qualified_id", event.target.value)}
                            placeholder={qualifiedExternalStageId || "Usar padrão da empresa"}
                            disabled={isLoading}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`project-${project.id}-visit`}>ID: Visita agendada</Label>
                          <Input
                            id={`project-${project.id}-visit`}
                            value={override?.external_stage_visit_scheduled_id ?? ""}
                            onChange={(event) => updateStageOverride(project.id, "external_stage_visit_scheduled_id", event.target.value)}
                            placeholder={visitScheduledExternalStageId || "Usar padrão da empresa"}
                            disabled={isLoading}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`project-${project.id}-lost`}>ID: Perdido</Label>
                          <Input
                            id={`project-${project.id}-lost`}
                            value={override?.external_stage_lost_id ?? ""}
                            onChange={(event) => updateStageOverride(project.id, "external_stage_lost_id", event.target.value)}
                            placeholder={lostExternalStageId || "Usar padrão da empresa"}
                            disabled={isLoading}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`project-${project.id}-without-whatsapp`}>ID: Sem WhatsApp</Label>
                          <Input
                            id={`project-${project.id}-without-whatsapp`}
                            value={override?.external_stage_without_whatsapp_id ?? ""}
                            onChange={(event) => updateStageOverride(project.id, "external_stage_without_whatsapp_id", event.target.value)}
                            placeholder={withoutWhatsappExternalStageId || "Usar padrão da empresa"}
                            disabled={isLoading}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`project-${project.id}-blocked-send`}>ID: Bloqueio Envio</Label>
                          <Input
                            id={`project-${project.id}-blocked-send`}
                            value={override?.external_stage_blocked_send_id ?? ""}
                            onChange={(event) => updateStageOverride(project.id, "external_stage_blocked_send_id", event.target.value)}
                            placeholder={blockedSendExternalStageId || "Usar padrão da empresa"}
                            disabled={isLoading}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum empreendimento cadastrado para esta empresa.</p>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!selectedCompanyId || saveMutation.isPending || isLoading}
            >
              {saveMutation.isPending ? "Salvando..." : "Salvar configuração"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
