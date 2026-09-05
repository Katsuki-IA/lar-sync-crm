import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  BotOff,
  Inbox,
  MessageCircle,
  MessagesSquare,
  Search,
  Send,
  UserCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { useCrmUser } from "@/hooks/use-crm-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/conversas")({
  validateSearch: (search: Record<string, unknown>) => ({
    lead: typeof search.lead === "string" ? search.lead : undefined,
  }),
  component: ConversationsPage,
});

type ConversationItem =
  Database["public"]["Functions"]["crm_whatsapp_list_conversations"]["Returns"][number];
type WhatsappConversationMessageRow =
  Database["public"]["Functions"]["crm_whatsapp_conversation_messages"]["Returns"][number];

type ConversationMessage = {
  id: string;
  type: string | null;
  message: Json | null;
  time: string | null;
  created_at: string | null;
};

type SendMessageResult = {
  ok: true;
  messageId: string;
  status: string | null;
};

function crmLeadId(value?: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function messageToText(message: Json | null): string {
  if (message == null) return "";
  if (typeof message === "string") return message;
  if (typeof message === "number" || typeof message === "boolean") return String(message);
  if (Array.isArray(message))
    return message
      .map((item) => messageToText(item))
      .filter(Boolean)
      .join("\n");

  const record = message as Record<string, Json>;
  const preferredKeys = ["content", "text", "message", "output", "body"];
  for (const key of preferredKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return JSON.stringify(message);
}

function isToolMessage(type: string | null, message: Json | null) {
  if (type?.trim().toLowerCase() === "tool") return true;

  return /^calling\s+.+\s+with\s+input\s*:/i.test(messageToText(message).trim());
}

async function functionError(error: unknown, fallback: string) {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json();
      if (typeof payload?.error === "string" && payload.error.trim()) return payload.error;
    } catch {
      // Mantém a mensagem original do SDK abaixo.
    }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function parseDateValue(value?: string | number | null) {
  if (!value) return "—";
  const raw = String(value).trim();
  if (!raw) return "—";

  const numeric = Number(raw);
  const date =
    Number.isFinite(numeric) && /^\d+$/.test(raw)
      ? new Date(raw.length <= 10 ? numeric * 1000 : numeric)
      : new Date(raw);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value?: string | number | null) {
  const date = parseDateValue(value);
  if (!date || date === "—") return "—";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value?: string | number | null) {
  const date = parseDateValue(value);
  if (!date || date === "—") return "—";
  return (
    date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }) +
    " " +
    date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    })
  );
}

function formatDateLabel(value?: string | number | null) {
  const date = parseDateValue(value);
  if (!date || date === "—") return "Data não informada";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function dateKey(value?: string | number | null) {
  const date = parseDateValue(value);
  if (!date || date === "—") return "unknown";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function timestampMs(value?: string | null) {
  const date = parseDateValue(value);
  return !date || date === "—" ? 0 : date.getTime();
}

function previewText(row: ConversationItem) {
  return row.last_message?.trim() || null;
}

function ConversationsPage() {
  const { lead } = Route.useSearch();
  const { data: me } = useCrmUser();
  const { activeEmpresaId } = useActiveEmpresa();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [onlyHuman, setOnlyHuman] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const conversationsQuery = useQuery({
    enabled: !!me && !!activeEmpresaId,
    queryKey: ["whatsapp-conversations", activeEmpresaId, deferredSearch, onlyHuman],
    refetchInterval: 5_000,
    queryFn: async (): Promise<ConversationItem[]> => {
      const { data, error } = await supabase.rpc("crm_whatsapp_list_conversations", {
        p_id_empresa: activeEmpresaId!,
        p_search: deferredSearch || undefined,
        p_only_human: onlyHuman,
        p_limit: 100,
        p_offset: 0,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);
  useEffect(() => {
    setSelectedId(null);
  }, [activeEmpresaId]);

  useEffect(() => {
    if (!lead || !conversations.length) return;
    const leadId = Number(lead);
    if (!Number.isFinite(leadId)) return;

    const conversation = conversations.find((item) => crmLeadId(item.id_crm) === leadId);
    if (conversation) setSelectedId(conversation.lead_id);
  }, [lead, conversations]);

  const selectedConversation = useMemo(() => {
    if (!conversations.length) return null;
    return conversations.find((item) => item.lead_id === selectedId) ?? conversations[0];
  }, [conversations, selectedId]);

  const messageQuery = useQuery({
    enabled: !!selectedConversation,
    queryKey: ["whatsapp-conversation-messages", selectedConversation?.lead_id],
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 3_000,
    queryFn: async (): Promise<ConversationMessage[]> => {
      if (!selectedConversation) return [];

      const sortMessages = (messages: ConversationMessage[]) =>
        [...messages].sort((a, b) => {
          const timeDifference =
            timestampMs(a.time ?? a.created_at) - timestampMs(b.time ?? b.created_at);

          return timeDifference || a.id.localeCompare(b.id, undefined, { numeric: true });
        });

      const mapChatRows = (rows: WhatsappConversationMessageRow[]) =>
        rows
          .filter((message) => !isToolMessage(message.type, message.message))
          .map((message) => ({
            id: `chat-${message.id}`,
            type: message.type,
            message: message.message,
            time: message.time,
            created_at: message.created_at,
          }));

      const { data, error } = await supabase.rpc("crm_whatsapp_conversation_messages", {
        p_lead_id: selectedConversation.lead_id,
        p_limit: 100,
      });
      if (error) throw error;
      return sortMessages(mapChatRows(data ?? []));
    },
  });

  const attendanceMutation = useMutation({
    mutationFn: async ({
      leadId,
      enabled,
      force = false,
    }: {
      leadId: number;
      enabled: boolean;
      force?: boolean;
    }) => {
      const { data, error } = await supabase.rpc("crm_whatsapp_set_conversation_attendance", {
        p_lead_id: leadId,
        p_enabled: enabled,
        p_force: force,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      toast.success(
        variables.enabled
          ? "Conversa assumida. A IA não responderá enquanto o atendimento humano estiver ativo."
          : "Conversa devolvida para a IA.",
      );
    },
    onError: (error: Error) =>
      toast.error("Não foi possível alterar o atendimento", {
        description: error.message,
      }),
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({ leadId, text }: { leadId: number; text: string }) => {
      const { data, error } = await supabase.functions.invoke<SendMessageResult>(
        "whatsapp-conversation-send",
        {
          body: {
            leadId,
            text,
            clientMessageId: crypto.randomUUID(),
          },
        },
      );
      if (error) {
        throw new Error(await functionError(error, "Falha ao enviar a mensagem pelo WhatsApp"));
      }
      if (!data?.ok) throw new Error("A Meta não confirmou o envio da mensagem");
      return data;
    },
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversation-messages"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      toast.success("Mensagem enviada");
    },
    onError: (error: Error) =>
      toast.error("Não foi possível enviar a mensagem", { description: error.message }),
  });

  const selectedLeadName = selectedConversation?.nome || "Conversa";
  const selectedLeadIdentity = selectedConversation
    ? selectedConversation.telefone ||
      selectedConversation.wa_username ||
      selectedConversation.display_name ||
      selectedConversation.wa_user_id ||
      "Contato sem telefone"
    : "";
  const selectedCrmLeadId = crmLeadId(selectedConversation?.id_crm);
  const assignedToMe =
    !!selectedConversation?.assigned_to && selectedConversation.assigned_to === me?.id;
  const assignedToOther = !!selectedConversation?.assigned_to && !assignedToMe;
  const canForceAssignment = me?.role === "manager" || me?.role === "super_admin";
  const canSendMessage = !!selectedConversation?.atendimento_humano && assignedToMe;
  const trimmedDraft = draft.trim();
  const submitMessage = () => {
    if (!selectedConversation || !canSendMessage || !trimmedDraft || trimmedDraft.length > 4096) {
      return;
    }
    sendMessageMutation.mutate({ leadId: selectedConversation.lead_id, text: trimmedDraft });
  };
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const latestMessageId = messageQuery.data?.at(-1)?.id;

  useEffect(() => {
    if (!latestMessageId) return;

    const frame = window.requestAnimationFrame(() => {
      const container = messagesScrollRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedConversation?.lead_id, latestMessageId]);

  const messageRows = useMemo(() => {
    const messages = messageQuery.data ?? [];

    return messages.map((message, index) => {
      const currentDateValue = message.time ?? message.created_at;
      const previousMessage = messages[index - 1];
      const previousDateValue = previousMessage
        ? (previousMessage.time ?? previousMessage.created_at)
        : null;

      return {
        message,
        dateLabel: formatDateLabel(currentDateValue),
        showDate: index === 0 || dateKey(currentDateValue) !== dateKey(previousDateValue),
      };
    });
  }, [messageQuery.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Conversas</h1>
          <p className="text-sm text-muted-foreground">
            Central de atendimento humano das conversas do WhatsApp.
          </p>
        </div>
        <Badge variant="outline" className="hidden sm:inline-flex">
          {conversations[0]?.total_count ?? conversations.length} conversa
          {(conversations[0]?.total_count ?? conversations.length) === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="min-h-[640px] overflow-hidden rounded-2xl border bg-card shadow-sm lg:grid lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="border-b lg:border-b-0 lg:border-r bg-background/70">
          <div className="border-b p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nome, telefone ou usuário"
                className="pl-9"
              />
            </div>
            <Button
              type="button"
              variant={onlyHuman ? "default" : "outline"}
              size="sm"
              className="mt-3 w-full"
              onClick={() => setOnlyHuman((value) => !value)}
            >
              <UserCheck className="mr-2 h-4 w-4" />
              {onlyHuman ? "Mostrando atendimento humano" : "Filtrar atendimento humano"}
            </Button>
          </div>

          <div className="h-[280px] overflow-y-auto lg:h-[calc(100vh-230px)]">
            {conversationsQuery.isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Carregando conversas...</div>
            ) : conversationsQuery.error ? (
              <div className="p-4 text-sm text-destructive">Erro ao carregar conversas.</div>
            ) : !conversations.length ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8" />
                Nenhuma conversa encontrada.
              </div>
            ) : (
              <div className="divide-y">
                {conversations.map((conversation) => {
                  const active = selectedConversation?.lead_id === conversation.lead_id;
                  const identity =
                    conversation.telefone ||
                    conversation.wa_username ||
                    conversation.display_name ||
                    conversation.wa_user_id;
                  const preview = previewText(conversation);

                  return (
                    <button
                      key={conversation.lead_id}
                      type="button"
                      onClick={() => setSelectedId(conversation.lead_id)}
                      className={cn(
                        "w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-muted/60",
                        active && "bg-primary/10 hover:bg-primary/10",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <MessageCircle className="h-4 w-4 shrink-0 text-primary" />
                            <p className="truncate font-medium">
                              {conversation.nome || "Sem nome"}
                            </p>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {identity || "Contato sem telefone"}
                          </p>
                          {conversation.atendimento_humano ? (
                            <Badge variant="secondary" className="mt-2 max-w-full truncate">
                              {conversation.assigned_name
                                ? `Com ${conversation.assigned_name}`
                                : "Aguardando atendente"}
                            </Badge>
                          ) : null}
                          {preview ? (
                            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                              {preview}
                            </p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                          <div>{formatDateTime(conversation.last_message_at)}</div>
                          {crmLeadId(conversation.id_crm) ? (
                            <div className="mt-2 font-medium">#{conversation.id_crm}</div>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-[640px] flex-col">
          {selectedConversation ? (
            <>
              <header className="flex items-center justify-between gap-3 border-b bg-background px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <UserRound className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate font-semibold">{selectedLeadName}</h2>
                      {selectedConversation.atendimento_humano ? (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                          Atendimento humano
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{selectedLeadIdentity}</p>
                    {selectedConversation.assigned_name ? (
                      <p className="truncate text-xs text-muted-foreground">
                        Responsável: {selectedConversation.assigned_name}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {selectedCrmLeadId ? (
                    <Button asChild variant="outline" size="sm" className="hidden md:inline-flex">
                      <Link to="/leads/$id" params={{ id: String(selectedCrmLeadId) }}>
                        Abrir lead
                        <ArrowUpRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  ) : null}

                  {selectedConversation.atendimento_humano && assignedToMe ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={attendanceMutation.isPending}
                      onClick={() =>
                        attendanceMutation.mutate({
                          leadId: selectedConversation.lead_id,
                          enabled: false,
                        })
                      }
                    >
                      <Bot className="mr-2 h-4 w-4" />
                      Devolver para a IA
                    </Button>
                  ) : assignedToOther && !canForceAssignment ? (
                    <Button type="button" variant="outline" size="sm" disabled>
                      <UserRound className="mr-2 h-4 w-4" />
                      Em atendimento
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={attendanceMutation.isPending}
                      onClick={() =>
                        attendanceMutation.mutate({
                          leadId: selectedConversation.lead_id,
                          enabled: true,
                          force: assignedToOther && canForceAssignment,
                        })
                      }
                    >
                      <BotOff className="mr-2 h-4 w-4" />
                      {assignedToOther ? "Assumir deste atendente" : "Assumir conversa"}
                    </Button>
                  )}
                </div>
              </header>

              <div ref={messagesScrollRef} className="flex-1 overflow-y-auto bg-background p-4">
                {messageQuery.isLoading ? (
                  <div className="rounded-lg bg-background/90 px-4 py-3 text-sm text-muted-foreground shadow-sm">
                    Carregando mensagens...
                  </div>
                ) : messageQuery.error ? (
                  <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-sm">
                    Erro ao carregar mensagens da conversa.
                  </div>
                ) : !messageQuery.data?.length ? (
                  <div className="mx-auto mt-10 max-w-sm rounded-lg bg-background/90 px-4 py-5 text-center text-sm text-muted-foreground shadow-sm">
                    Nenhuma mensagem encontrada para esta conversa.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messageRows.map(({ message, showDate, dateLabel }) => {
                      const isAi = message.type === "ai";
                      const text = messageToText(message.message);

                      return (
                        <div key={message.id} className="space-y-3">
                          {showDate ? (
                            <div className="flex justify-center">
                              <span className="rounded-full border bg-background/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
                                {dateLabel}
                              </span>
                            </div>
                          ) : null}

                          <div className={cn("flex", isAi ? "justify-end" : "justify-start")}>
                            <div
                              className={cn(
                                "max-w-[82%] rounded-2xl px-4 py-2 text-sm shadow-sm md:max-w-[68%]",
                                isAi
                                  ? "rounded-br-md bg-primary/15 text-foreground"
                                  : "rounded-bl-md bg-white text-foreground",
                              )}
                            >
                              <MessageContent text={text || "Mensagem sem conteúdo"} />
                              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                                {isAi ? <Bot className="h-3 w-3" /> : null}
                                {formatTime(message.time ?? message.created_at)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <footer className="space-y-3 border-t bg-background px-4 py-3">
                {canSendMessage ? (
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <Textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            submitMessage();
                          }
                        }}
                        placeholder="Digite uma mensagem. Enter envia; Shift + Enter quebra a linha."
                        maxLength={4096}
                        rows={2}
                        disabled={sendMessageMutation.isPending}
                        className="min-h-16 resize-none"
                      />
                      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                        <span>
                          Mensagem livre disponível dentro da janela de atendimento da Meta.
                        </span>
                        <span>{draft.length}/4096</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      aria-label="Enviar mensagem"
                      disabled={!trimmedDraft || sendMessageMutation.isPending}
                      onClick={submitMessage}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                    {assignedToOther
                      ? `Conversa em atendimento por ${selectedConversation.assigned_name || "outro atendente"}.`
                      : "Assuma a conversa para enviar mensagens manualmente."}
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  Última mensagem: {formatDateTime(selectedConversation.last_message_at)}
                  {selectedConversation.atendimento_humano_desde ? (
                    <span className="ml-3">
                      Atendimento humano desde{" "}
                      {formatDateTime(selectedConversation.atendimento_humano_desde)}
                    </span>
                  ) : null}
                </div>
              </footer>
            </>
          ) : (
            <div className="flex min-h-[640px] flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <MessagesSquare className="h-10 w-10" />
              <div>
                <p className="font-medium text-foreground">Selecione uma conversa</p>
                <p className="text-sm">As mensagens do atendimento aparecerão aqui.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MessageContent({ text }: { text: string }) {
  const parts = text.split(/(\[IMG\s*:\s*[^\]\s]+\s*\])/gi);

  return (
    <div className="space-y-2 leading-relaxed">
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
