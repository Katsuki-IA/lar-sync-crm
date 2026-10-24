import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfigSection, ConfigStatus } from "@/components/config-presentation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/hml/modules";
import {
  getSecretaryAiSettings,
  saveSecretaryAiSettings,
} from "@/lib/secretary-settings.functions";
import { SECRETARY_TONES, type SecretaryTone } from "@/lib/secretary-interpreter";

const toneLabel: Record<SecretaryTone, string> = {
  cordial: "Cordial",
  objetivo: "Objetivo",
  formal: "Formal",
};

/**
 * Seção "Interpretação de texto" da página Configurações > Secretária.
 * Desativada por padrão; quando o backend da fase 1 não está instalado,
 * mostra o estado real e mantém os controles desabilitados. Escrita e
 * prompt base são exclusivos de super admin; gestor apenas visualiza.
 */
export function SecretaryAiSettings({
  companyId,
  isAdmin,
}: {
  companyId: number;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["secretary-ai-settings", companyId],
    queryFn: () => getSecretaryAiSettings({ data: { companyId } }),
  });
  const [tone, setTone] = useState<SecretaryTone>("cordial");
  const [basePrompt, setBasePrompt] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  const settings = query.data;
  useEffect(() => {
    if (settings?.installed) {
      setTone(settings.tone);
      setBasePrompt(settings.basePrompt ?? "");
      setEnabled(settings.enabled);
    }
  }, [settings]);

  async function save() {
    setSaving(true);
    try {
      await saveSecretaryAiSettings({
        data: { companyId, enabled, tone, basePrompt: basePrompt.trim() || null },
      });
      toast.success("Interpretação de texto atualizada");
      await queryClient.invalidateQueries({ queryKey: ["secretary-ai-settings", companyId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConfigSection>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Interpretação de texto</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Entende mensagens livres do corretor para listar os leads dele e aceitar ou recusar
            ofertas pendentes. Os comandos ACEITAR/RECUSAR com código continuam valendo.
          </p>
        </div>
        {settings?.installed ? (
          <ConfigStatus>
            {settings.enabled && settings.aiConfigured
              ? "Ativa"
              : settings.enabled
                ? "Configuração pendente"
                : "Desativada"}
          </ConfigStatus>
        ) : (
          <ConfigStatus>Não instalada</ConfigStatus>
        )}
      </header>
      {query.isPending ? (
        <p className="text-sm">Carregando…</p>
      ) : query.isError ? (
        <Button variant="outline" onClick={() => query.refetch()}>
          Recarregar
        </Button>
      ) : !settings?.installed ? (
        <p className="text-sm text-muted-foreground">
          A interpretação de texto ainda não está instalada no banco desta empresa. A instalação
          será feita pela administração antes da ativação; até lá, nenhuma mensagem livre é
          processada.
        </p>
      ) : (
        <div className="config-form space-y-6">
          <label className="block space-y-1 text-sm">
            Tom das respostas
            <select
              aria-label="Tom das respostas"
              className={inputClass}
              value={tone}
              disabled={!isAdmin}
              onChange={(e) => setTone(e.target.value as SecretaryTone)}
            >
              {SECRETARY_TONES.map((t) => (
                <option key={t} value={t}>
                  {toneLabel[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            Regras adicionais da empresa (prompt base)
            <textarea
              aria-label="Regras adicionais da empresa"
              className={`${inputClass} min-h-28`}
              maxLength={2000}
              value={basePrompt}
              disabled={!isAdmin}
              placeholder={
                isAdmin
                  ? "Orientações específicas da empresa, sem alterar as intenções permitidas."
                  : "Somente o super admin pode editar as regras."
              }
              onChange={(e) => setBasePrompt(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!isAdmin}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Interpretar mensagens livres dos corretores
          </label>
          {settings.enabled && !settings.aiConfigured && (
            <p className="text-xs text-muted-foreground">
              A interpretação está marcada como ativa, mas a credencial de IA ainda não está
              configurada no servidor; mensagens livres receberão a ajuda até a configuração.
            </p>
          )}
          {!isAdmin && (
            <p className="text-xs text-muted-foreground">
              Somente o super admin pode alterar o tom, as regras e a ativação.
            </p>
          )}
          {isAdmin && (
            <div className="flex justify-end">
              <Button disabled={saving} onClick={save}>
                {saving ? "Salvando…" : "Salvar interpretação"}
              </Button>
            </div>
          )}
        </div>
      )}
    </ConfigSection>
  );
}
