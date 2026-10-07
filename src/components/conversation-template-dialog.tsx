import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  templateFields,
  templatePreview,
  type ConversationTemplate,
} from "../../supabase/functions/_shared/conversation-templates";

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("whatsapp-conversation-send", {
    body,
  });
  if (error) {
    let message = error.message;
    if (error.context instanceof Response) {
      try {
        const payload = await error.context.clone().json();
        message = payload.error || message;
      } catch {
        /* Keep SDK error. */
      }
    }
    throw new Error(message);
  }
  if (!data) throw new Error("Não foi possível obter a resposta do WhatsApp");
  return data;
}

export function ConversationTemplateDialog({
  leadId,
  leadName,
  companyId,
  assume,
  disabled = false,
  label = "Assumir e enviar template",
}: {
  leadId: number;
  leadName: string | null;
  companyId: number;
  assume?: () => Promise<unknown>;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [claimed, setClaimed] = useState(false);
  const requestId = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const templatesQuery = useQuery({
    queryKey: ["conversation-attendance-templates", companyId, leadId],
    enabled: open,
    staleTime: 0,
    retry: false,
    queryFn: () =>
      invoke<{ templates: ConversationTemplate[] }>({ action: "list_templates", leadId }),
  });
  const templates = templatesQuery.data?.templates ?? [];
  const selectedKey =
    selection || (templates.length === 1 ? `${templates[0].name}:${templates[0].language}` : "");
  const selected = templates.find((t) => `${t.name}:${t.language}` === selectedKey);
  const form = useMemo(() => {
    if (!selected) return { fields: [], error: null };
    try {
      return { fields: templateFields(selected), error: null };
    } catch (error) {
      return { fields: [], error: error instanceof Error ? error.message : "Modelo não suportado" };
    }
  }, [selected]);
  const isCustomerNameField = (key: string) =>
    selected?.name === "assumir_conversa_1" && key === "body:1";
  const resolvedValues: Record<string, string> = {
    ...(selected?.name === "assumir_conversa_1" ? { "body:1": leadName?.trim() ?? "" } : {}),
    ...values,
  };
  const send = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Selecione um template");
      if (assume) {
        await assume();
        setClaimed(true);
      }
      requestId.current ??= crypto.randomUUID();
      return invoke<{ ok: boolean }>({
        action: "send_template",
        leadId,
        templateName: selected.name,
        templateLanguage: selected.language,
        templateValues: resolvedValues,
        clientMessageId: requestId.current,
      });
    },
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error("A Meta não confirmou o envio do template");
        return;
      }
      setOpen(false);
      requestId.current = null;
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversation-messages"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversation-windows"] });
      toast.success(
        "Template aceito pela Meta. Aguarde o cliente responder para enviar mensagens livres.",
      );
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!send.isPending) {
          setOpen(value);
          if (value) send.reset();
        }
      }}
    >
      <Button type="button" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <Send className="mr-2 h-4 w-4" />
        {label}
      </Button>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            A janela de 24 horas está fechada. Envie um template aprovado e aguarde o cliente
            responder para liberar mensagens livres.
          </DialogDescription>
        </DialogHeader>
        {templatesQuery.isFetching ? (
          <p className="text-sm text-muted-foreground">Carregando templates...</p>
        ) : templatesQuery.error ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              {templatesQuery.error.message}
            </p>
            <Button variant="outline" onClick={() => templatesQuery.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : !templates.length ? (
          <p className="text-sm text-muted-foreground">
            Nenhum template aprovado com nome assumir_conversa_1, assumir_conversa_2, etc. foi
            encontrado nesta empresa.
          </p>
        ) : (
          <>
            <Select
              value={selectedKey}
              disabled={send.isPending}
              onValueChange={(value) => {
                setSelection(value);
                setValues({});
                requestId.current = null;
                send.reset();
              }}
            >
              <SelectTrigger aria-label="Template de atendimento">
                <SelectValue placeholder="Selecione um template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={`${t.name}:${t.language}`} value={`${t.name}:${t.language}`}>
                    {t.name} ({t.language})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.error ? (
              <p role="alert" className="text-sm text-destructive">
                {form.error}
              </p>
            ) : (
              form.fields.map((field) => (
                <label key={field.key} className="space-y-1 text-sm">
                  <span>{isCustomerNameField(field.key) ? "Nome do cliente" : field.label}</span>
                  <Input
                    value={resolvedValues[field.key] ?? ""}
                    placeholder={
                      isCustomerNameField(field.key) ? "Informe o nome do cliente" : undefined
                    }
                    disabled={send.isPending}
                    maxLength={1024}
                    onChange={(event) => {
                      setValues((current) => ({ ...current, [field.key]: event.target.value }));
                      requestId.current = null;
                      send.reset();
                    }}
                  />
                </label>
              ))
            )}
            {selected && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Prévia da mensagem</p>
                <div className="whitespace-pre-wrap rounded-lg border bg-muted p-3 text-sm">
                  {templatePreview(selected, resolvedValues) || selected.name}
                </div>
              </div>
            )}
          </>
        )}
        {send.error && (
          <p role="alert" className="text-sm text-destructive">
            {claimed ? "A conversa foi assumida, mas o envio do template falhou. " : ""}
            {send.error.message}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={send.isPending} onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={
              send.isPending ||
              templatesQuery.isFetching ||
              !!templatesQuery.error ||
              !selected ||
              !!form.error ||
              form.fields.some((f) => !resolvedValues[f.key]?.trim())
            }
            onClick={() => send.mutate()}
          >
            {send.isPending
              ? "Enviando..."
              : assume && !claimed
                ? "Assumir e enviar"
                : "Enviar template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
