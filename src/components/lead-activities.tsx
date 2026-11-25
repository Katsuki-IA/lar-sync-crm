import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type LeadActivity = {
  id: number;
  tipo: string;
  descricao: string | null;
  created_at: string | null;
  crm_user_id: string | null;
  metadata?: any;
  crm_users?: { nome: string | null } | null;
};

export function useLeadActivities(leadId: number, companyId: number | null, actorId?: string) {
  return useQuery({
    enabled: !!leadId && !!companyId && !!actorId,
    queryKey: ["lead-activities", leadId, companyId, actorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_lead_activities")
        .select("id, tipo, descricao, created_at, crm_user_id, metadata, crm_users(nome)")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LeadActivity[];
    },
  });
}

export function LeadActivities({
  leadId,
  companyId,
  userMap,
}: {
  leadId: number;
  companyId: number;
  userMap?: Map<string, string | null>;
}) {
  const { data: me } = useCrmUser();
  const canWrite = me?.active && me.role === "super_admin";
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const {
    data: activities,
    isPending,
    isError,
    refetch,
  } = useLeadActivities(leadId, companyId, me?.id);
  const noteMut = useMutation({
    mutationFn: async (text: string) => {
      const { error } = await supabase.from("crm_lead_activities").insert({
        lead_id: leadId,
        crm_user_id: me!.id,
        tipo: "note",
        descricao: text,
      });
      if (error) throw error;
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível salvar a nota."),
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["lead-activities", leadId] });
      toast.success("Nota adicionada");
    },
  });
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-base">Atividade</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canWrite && (
          <div className="flex gap-2">
            <Textarea
              aria-label="Nova nota do lead"
              placeholder="Adicionar nota..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-20"
            />
            <Button
              className="self-end rounded-xl"
              disabled={!note.trim() || noteMut.isPending}
              onClick={() => noteMut.mutate(note.trim())}
            >
              Salvar nota
            </Button>
          </div>
        )}
        <div className="space-y-3 pt-2">
          {(activities ?? []).map((a) => (
            <div key={a.id} className="flex gap-3 pb-3 border-b border-border last:border-0">
              <div className="h-2 w-2 rounded-full bg-primary mt-2 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {a.metadata?.source === "hub_conversation_attendance"
                      ? "Atendimento"
                      : labelTipo(a.tipo)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {a.created_at ? new Date(a.created_at).toLocaleString("pt-BR") : ""}
                  </span>
                </div>
                <ActivityDescription text={a.descricao} />
                {a.crm_user_id && (
                  <p className="text-xs text-muted-foreground mt-1">
                    por {a.crm_users?.nome ?? userMap?.get(a.crm_user_id) ?? "—"}
                  </p>
                )}
              </div>
            </div>
          ))}
          {isPending && <p>Carregando atividades…</p>}
          {isError && (
            <button onClick={() => refetch()}>
              Falha ao carregar atividades. Tentar novamente
            </button>
          )}
          {!isError && !isPending && !activities?.length && (
            <p className="text-sm text-muted-foreground">Nenhuma atividade ainda.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
function ActivityDescription({ text }: { text?: string | null }) {
  if (!text) return null;

  const parts = text.split(/(\[IMG\s*:\s*[^\]\s]+\s*\])/gi);

  return (
    <div className="mt-0.5 space-y-2 text-sm">
      {parts.map((part, index) => {
        const match = part.match(/^\[IMG\s*:\s*([^\]\s]+)\s*\]$/i);
        if (match) {
          const fileId = match[1];
          return (
            <a
              key={`${fileId}-${index}`}
              href={`https://drive.google.com/file/d/${fileId}/view`}
              target="_blank"
              rel="noreferrer"
              className="block w-fit max-w-full cursor-pointer overflow-hidden rounded-lg border bg-background shadow-sm"
              title="Abrir imagem"
            >
              <img
                src={`https://drive.google.com/thumbnail?id=${fileId}&sz=w600`}
                alt="Imagem enviada pela IA"
                className="block max-h-[360px] w-full max-w-[600px] object-contain"
                loading="lazy"
              />
            </a>
          );
        }

        return part ? (
          <span key={index} className="block whitespace-pre-wrap break-words">
            {part}
          </span>
        ) : null;
      })}
    </div>
  );
}

function labelTipo(t: string) {
  switch (t) {
    case "note":
      return "Nota";
    case "stage_change":
      return "Estágio";
    case "assignment":
      return "Atribuição";
    case "tag_add":
      return "Tag";
    case "tag_remove":
      return "Tag";
    case "custom_fields":
      return "Campos";
    case "meta_resubmission":
      return "Meta Ads";
    case "rd_conversion":
      return "RD Station";
    case "crm_export":
      return "Envio CRM";
    case "system":
      return "Sistema";
    default:
      return t;
  }
}
