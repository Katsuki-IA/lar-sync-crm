import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/settings/empreendimentos")({
  component: EmpreendimentosPage,
});

type Empreendimento = {
  id: number;
  id_empresa: number;
  nome: string;
};

type AtendimentoConfig = {
  id_empresa: number;
  id_empreendimento: number;
  atendimento_ativo: boolean;
};

function EmpreendimentosPage() {
  const qc = useQueryClient();
  const { data: allowed } = useAllowedEmpresas();

  const { data, isLoading } = useQuery({
    enabled: !!allowed,
    queryKey: ["settings-empreendimentos-atendimento", allowed],
    queryFn: async () => {
      const empresaIds = allowed ?? [];
      if (!empresaIds.length) return [];

      const [{ data: empreendimentos, error: empError }, { data: configs, error: configError }] =
        await Promise.all([
          supabase
            .from("empreendimento")
            .select("id,id_empresa,nome")
            .in("id_empresa", empresaIds)
            .order("nome", { ascending: true }),
          supabase
            .from("crm_empreendimento_atendimento")
            .select("id_empresa,id_empreendimento,atendimento_ativo")
            .in("id_empresa", empresaIds),
        ]);

      if (empError) throw empError;
      if (configError) throw configError;

      const configMap = new Map(
        ((configs ?? []) as AtendimentoConfig[]).map((config) => [
          `${config.id_empresa}:${config.id_empreendimento}`,
          config.atendimento_ativo,
        ]),
      );

      return ((empreendimentos ?? []) as Empreendimento[]).map((empreendimento) => ({
        ...empreendimento,
        atendimento_ativo:
          configMap.get(`${empreendimento.id_empresa}:${empreendimento.id}`) ?? false,
      }));
    },
  });

  const toggle = useMutation({
    mutationFn: async (input: {
      idEmpresa: number;
      idEmpreendimento: number;
      atendimentoAtivo: boolean;
    }) => {
      const { error } = await supabase
        .from("crm_empreendimento_atendimento")
        .upsert(
          {
            id_empresa: input.idEmpresa,
            id_empreendimento: input.idEmpreendimento,
            atendimento_ativo: input.atendimentoAtivo,
          },
          { onConflict: "id_empresa,id_empreendimento" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Empreendimento atualizado");
      qc.invalidateQueries({ queryKey: ["settings-empreendimentos-atendimento"] });
    },
    onError: (error: Error) => {
      toast.error("Falha ao atualizar empreendimento", { description: error.message });
    },
  });

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-medium">Empreendimentos</h2>
        <p className="text-sm text-muted-foreground">
          Defina quais empreendimentos devem enviar novos leads para a fila de atendimento.
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando...</div>
      ) : !data?.length ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          Nenhum empreendimento encontrado.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Empreendimento</th>
                <th className="text-right px-4 py-3">Atendimento</th>
              </tr>
            </thead>
            <tbody>
              {data.map((empreendimento) => (
                <tr key={empreendimento.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="font-medium">{empreendimento.nome}</div>
                        <div className="text-xs text-muted-foreground">
                          ID {empreendimento.id}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {empreendimento.atendimento_ativo ? "Ativo" : "Inativo"}
                      </span>
                      <Switch
                        checked={empreendimento.atendimento_ativo}
                        disabled={toggle.isPending}
                        onCheckedChange={(checked) =>
                          toggle.mutate({
                            idEmpresa: empreendimento.id_empresa,
                            idEmpreendimento: empreendimento.id,
                            atendimentoAtivo: checked,
                          })
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
