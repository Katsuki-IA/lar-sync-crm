import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  FileText,
  MessageSquareText,
  RefreshCw,
  Send,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { getWhatsAppIntegrationStatus } from "@/lib/whatsapp-embedded.functions";
import {
  createWhatsAppReviewTemplate,
  getWhatsAppReviewState,
  sendWhatsAppReviewTemplate,
  type WhatsAppReviewTemplate,
} from "@/lib/whatsapp-review.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

function templateBody(template: WhatsAppReviewTemplate) {
  const body = template.components?.find((component) => component.type === "BODY");
  return typeof body?.text === "string" ? body.text : "";
}

function parameterCount(text: string) {
  const indexes = Array.from(text.matchAll(/\{\{(\d+)\}\}/gu), (match) => Number(match[1]));
  return indexes.length ? Math.max(...indexes) : 0;
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function statusBadge(status: string | null | undefined) {
  const normalized = status?.toUpperCase() ?? "DESCONHECIDO";
  const success = ["APPROVED", "DELIVERED", "READ"].includes(normalized);
  const danger = ["REJECTED", "FAILED"].includes(normalized);
  return (
    <Badge variant={danger ? "destructive" : success ? "default" : "secondary"}>{normalized}</Badge>
  );
}

export function WhatsAppMetaReviewPanel() {
  const { activeEmpresaId, activeEmpresa } = useActiveEmpresa();
  const queryClient = useQueryClient();
  const [templateName, setTemplateName] = useState("teste_aprovacao_katsuki");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [language, setLanguage] = useState("pt_BR");
  const [body, setBody] = useState("Olá, {{1}}. Esta é uma mensagem de teste do Hub Katsuki.");
  const [examples, setExamples] = useState(["Cliente Teste"]);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [destination, setDestination] = useState("");
  const [parameters, setParameters] = useState<string[]>([]);

  const statusQuery = useQuery({
    queryKey: ["whatsapp-integration-status", activeEmpresaId],
    enabled: Boolean(activeEmpresaId),
    queryFn: () => getWhatsAppIntegrationStatus(activeEmpresaId!),
    retry: false,
  });
  const isTestConnection =
    statusQuery.data?.connection?.status === "connected" &&
    statusQuery.data.connection.activation_status === "test";
  const stateQuery = useQuery({
    queryKey: ["whatsapp-review-state", activeEmpresaId],
    enabled: Boolean(activeEmpresaId && isTestConnection),
    queryFn: () => getWhatsAppReviewState(activeEmpresaId!),
    retry: false,
    refetchInterval: 10_000,
  });

  const approvedTemplates = useMemo(
    () => stateQuery.data?.templates.filter((template) => template.status === "APPROVED") ?? [],
    [stateQuery.data?.templates],
  );
  const selectedTemplate = approvedTemplates.find(
    (template) => `${template.name}:${template.language}` === selectedTemplateKey,
  );
  const createParameterCount = parameterCount(body);

  useEffect(() => {
    setExamples((current) =>
      Array.from({ length: createParameterCount }, (_, index) => current[index] ?? ""),
    );
  }, [createParameterCount]);

  useEffect(() => {
    const count = selectedTemplate ? parameterCount(templateBody(selectedTemplate)) : 0;
    setParameters(Array.from({ length: count }, () => ""));
  }, [selectedTemplateKey, selectedTemplate]);

  const createMutation = useMutation({
    mutationFn: () =>
      createWhatsAppReviewTemplate({
        empresaId: activeEmpresaId!,
        name: templateName,
        category,
        language,
        body,
        examples,
      }),
    onSuccess: async () => {
      toast.success("Modelo enviado para análise da Meta");
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-review-state", activeEmpresaId] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Falha ao criar modelo"),
  });

  const sendMutation = useMutation({
    mutationFn: () => {
      if (!selectedTemplate) throw new Error("Selecione um modelo aprovado");
      return sendWhatsAppReviewTemplate({
        empresaId: activeEmpresaId!,
        to: destination,
        name: selectedTemplate.name,
        language: selectedTemplate.language,
        parameters,
      });
    },
    onSuccess: async ({ messageId }) => {
      toast.success(`Mensagem aceita pela Meta (${messageId})`);
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-review-state", activeEmpresaId] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Falha ao enviar mensagem"),
  });

  if (!isTestConnection) return null;

  const state = stateQuery.data;
  const timeline = [
    ...(state?.events.map((event) => ({
      id: `event-${event.id}`,
      type: event.event_type,
      detail: event.message_id ?? event.source,
      at: event.occurred_at,
      payload: event.payload,
    })) ?? []),
    ...(state?.statusEvents.map((event) => ({
      id: `status-${event.id}`,
      type: `status: ${event.status}`,
      detail: event.message_id,
      at: event.timestamp_meta ?? event.created_at,
      payload: event.raw,
    })) ?? []),
  ]
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    .slice(0, 100);

  return (
    <Card>
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Teste da integração Meta</CardTitle>
              <Badge variant="secondary">Ambiente isolado</Badge>
            </div>
            <CardDescription className="mt-1">
              Crie as evidências de análise sem ativar o fluxo de produção. Empresa:{" "}
              {activeEmpresa?.nome}.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void stateQuery.refetch()}
            disabled={stateQuery.isFetching}
          >
            <RefreshCw
              className={stateQuery.isFetching ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"}
            />
            Atualizar
          </Button>
        </div>
        {state?.webhook.callbackUrl ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-medium">
                  <Webhook className="h-3.5 w-3.5" /> Callback para o app Agente IA HUB
                </p>
                <p className="mt-1 break-all text-muted-foreground">{state.webhook.callbackUrl}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(state.webhook.callbackUrl ?? "")
                    .then(() => toast.success("URL copiada"))
                }
              >
                <Clipboard className="mr-2 h-3.5 w-3.5" /> Copiar
              </Button>
            </div>
            {!state.webhook.verifyTokenConfigured ? (
              <p className="mt-2 flex items-center gap-1.5 text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" /> Falta configurar o segredo de verificação
                do webhook.
              </p>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Segredo de verificação configurado.
              </p>
            )}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="pt-6">
        {stateQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando ambiente de teste...</p>
        ) : null}
        {stateQuery.error ? (
          <p className="text-sm text-destructive">
            {stateQuery.error instanceof Error
              ? stateQuery.error.message
              : "Falha ao carregar o ambiente"}
          </p>
        ) : null}
        {state ? (
          <Tabs defaultValue="templates">
            <TabsList className="grid h-auto w-full grid-cols-3">
              <TabsTrigger value="templates">
                <FileText className="mr-2 h-4 w-4" /> Modelos
              </TabsTrigger>
              <TabsTrigger value="send">
                <Send className="mr-2 h-4 w-4" /> Enviar mensagem
              </TabsTrigger>
              <TabsTrigger value="events">
                <MessageSquareText className="mr-2 h-4 w-4" /> Mensagens e eventos
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="templates"
              className="grid gap-5 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
            >
              <div className="space-y-4 rounded-lg border p-4">
                <div>
                  <h3 className="font-medium">Criar modelo</h3>
                  <p className="text-xs text-muted-foreground">
                    O modelo será enviado à Meta e poderá ficar pendente até a aprovação.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="review-template-name">Nome</Label>
                  <Input
                    id="review-template-name"
                    value={templateName}
                    onChange={(event) =>
                      setTemplateName(event.target.value.toLowerCase().replace(/[^a-z0-9_]/gu, "_"))
                    }
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Categoria</Label>
                    <Select
                      value={category}
                      onValueChange={(value) => setCategory(value as "UTILITY" | "MARKETING")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UTILITY">Utilidade</SelectItem>
                        <SelectItem value="MARKETING">Marketing</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="review-template-language">Idioma</Label>
                    <Input
                      id="review-template-language"
                      value={language}
                      onChange={(event) => setLanguage(event.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="review-template-body">Mensagem</Label>
                  <Textarea
                    id="review-template-body"
                    rows={4}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use variáveis sequenciais como {"{{1}}"} e {"{{2}}"}.
                  </p>
                </div>
                {examples.map((example, index) => (
                  <div className="space-y-2" key={index}>
                    <Label htmlFor={`review-example-${index}`}>
                      Exemplo para {`{{${index + 1}}}`}
                    </Label>
                    <Input
                      id={`review-example-${index}`}
                      value={example}
                      onChange={(event) =>
                        setExamples((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? event.target.value : item,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
                <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Criando..." : "Criar modelo"}
                </Button>
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Modelos da WABA</h3>
                  <p className="text-xs text-muted-foreground">
                    {state.templates.length} modelo(s) encontrado(s).
                  </p>
                </div>
                {state.templatesError ? (
                  <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">
                    {state.templatesError}
                  </p>
                ) : null}
                <ScrollArea className="h-[420px] pr-3">
                  <div className="space-y-3">
                    {state.templates.map((template) => (
                      <div
                        key={`${template.name}-${template.language}`}
                        className="rounded-lg border p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">{template.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {template.language} · {template.category ?? "—"}
                            </p>
                          </div>
                          {statusBadge(template.status)}
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm">
                          {templateBody(template) || "Modelo sem corpo de texto"}
                        </p>
                        {template.rejected_reason ? (
                          <p className="mt-2 text-xs text-destructive">
                            Motivo: {template.rejected_reason}
                          </p>
                        ) : null}
                      </div>
                    ))}
                    {!state.templates.length ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        Nenhum modelo criado.
                      </p>
                    ) : null}
                  </div>
                </ScrollArea>
              </div>
            </TabsContent>

            <TabsContent value="send" className="max-w-2xl space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Modelo aprovado</Label>
                <Select value={selectedTemplateKey} onValueChange={setSelectedTemplateKey}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um modelo" />
                  </SelectTrigger>
                  <SelectContent>
                    {approvedTemplates.map((template) => (
                      <SelectItem
                        key={`${template.name}:${template.language}`}
                        value={`${template.name}:${template.language}`}
                      >
                        {template.name} · {template.language}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!approvedTemplates.length ? (
                  <p className="text-xs text-amber-600">Ainda não há modelo aprovado pela Meta.</p>
                ) : null}
              </div>
              {selectedTemplate ? (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                  {templateBody(selectedTemplate)}
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="review-destination">Destinatário</Label>
                <Input
                  id="review-destination"
                  inputMode="tel"
                  placeholder="5541999999999"
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Informe DDI + DDD + número, somente dígitos.
                </p>
              </div>
              {parameters.map((parameter, index) => (
                <div className="space-y-2" key={index}>
                  <Label htmlFor={`review-parameter-${index}`}>Valor de {`{{${index + 1}}}`}</Label>
                  <Input
                    id={`review-parameter-${index}`}
                    value={parameter}
                    onChange={(event) =>
                      setParameters((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? event.target.value : item,
                        ),
                      )
                    }
                  />
                </div>
              ))}
              <Button
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending || !selectedTemplate}
              >
                <Send className="mr-2 h-4 w-4" />{" "}
                {sendMutation.isPending ? "Enviando..." : "Enviar pela API da Meta"}
              </Button>
            </TabsContent>

            <TabsContent value="events" className="grid gap-5 pt-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-3 font-medium">Mensagens</h3>
                <ScrollArea className="h-[440px] pr-3">
                  <div className="space-y-3">
                    {state.messages.map((message) => (
                      <div key={message.id} className="rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">
                              {message.direction === "inbound"
                                ? `Recebida de ${message.contact_name ?? message.from_wa_id ?? "contato"}`
                                : `Enviada para ${message.to_wa_id ?? "destinatário"}`}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(message.timestamp_meta ?? message.created_at)}
                            </p>
                          </div>
                          {statusBadge(
                            message.status_current ??
                              (message.direction === "inbound" ? "received" : null),
                          )}
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm">
                          {message.text_body ??
                            (message.template_name
                              ? `Modelo: ${message.template_name}`
                              : `Tipo: ${message.type ?? "desconhecido"}`)}
                        </p>
                        {message.error_message ? (
                          <p className="mt-2 text-xs text-destructive">{message.error_message}</p>
                        ) : null}
                      </div>
                    ))}
                    {!state.messages.length ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        Nenhuma mensagem registrada.
                      </p>
                    ) : null}
                  </div>
                </ScrollArea>
              </div>
              <div>
                <h3 className="mb-3 font-medium">Eventos do webhook</h3>
                <ScrollArea className="h-[440px] pr-3">
                  <div className="space-y-3">
                    {timeline.map((event) => (
                      <details key={event.id} className="rounded-lg border p-3">
                        <summary className="cursor-pointer list-none">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium">{event.type}</p>
                              <p className="text-xs text-muted-foreground">
                                {event.detail} · {formatDate(event.at)}
                              </p>
                            </div>
                            <Webhook className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </summary>
                        <pre className="mt-3 max-h-52 overflow-auto rounded bg-muted p-2 text-[11px]">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      </details>
                    ))}
                    {!timeline.length ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        Nenhum evento recebido.
                      </p>
                    ) : null}
                  </div>
                </ScrollArea>
              </div>
            </TabsContent>
          </Tabs>
        ) : null}
      </CardContent>
    </Card>
  );
}
