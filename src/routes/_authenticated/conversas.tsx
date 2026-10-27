// Native Conversations activated only in HML; production route remains separate.
import { nativeConversationApi, sendNativeConversationText, type NativeTextRequest } from '@/hml/native-conversation-api';
import { parseConversationLead, selectNativeConversation } from '@/hml/conversation-selection';
import { db, useCompanyModules } from '@/hml/modules';
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  Bot,
  BotOff,
  CircleAlert,
  CheckCheck,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ConversationTemplateDialog } from "@/components/conversation-template-dialog";
import { ConversationAttachment, ConversationAttachmentComposer, getConversationAttachment } from "@/components/conversation-attachment";

export const Route = createFileRoute("/_authenticated/conversas")({
  validateSearch: (search: Record<string, unknown>) => ({
    lead: search.lead == null ? undefined : (parseConversationLead(search.lead) ?? ""),
  }),
  component: ConversationsPage,
});

type ConversationItem =
  Database["public"]["Functions"]["crm_whatsapp_list_conversations"]["Returns"][number];
type ConversationWindow =
  Database["public"]["Functions"]["crm_whatsapp_conversation_windows"]["Returns"][number];
type WhatsappConversationMessageRow =
  Database["public"]["Functions"]["crm_whatsapp_conversation_messages_v2"]["Returns"][number];

type ConversationMessage = {
  id: string;
  type: string | null;
  message: Json | null;
  time: string | null;
  created_at: string | null;
  direction: string | null;
  source: string | null;
  delivery_status: string | null;
  error_code: string | null;
  error_message: string | null;
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

function isEmptyInternalAiMessage(type: string | null, message: Json | null) {
  return type?.trim().toLowerCase() === "ai" && !messageToText(message).trim();
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
  const preview = row.last_message?.trim();
  if (!preview) return null;

  // Alguns registros legados guardaram o timestamp no campo de prévia.
  if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/.test(preview)) return null;
  return preview;
}

const nativeApi = nativeConversationApi(db);
function ConversationsPage() {
  const {lead:requestedLead}=Route.useSearch();
  const {activeEmpresaId}=useActiveEmpresa();
  const {data:me}=useCrmUser();
  const modules=useCompanyModules();
  if(requestedLead==='')return <p role="alert">Identificação de lead inválida. Abra a conversa pela tela de Leads.</p>;
  if(modules.isError)return <p role="alert">Não foi possível verificar os módulos da empresa.</p>;
  if(!activeEmpresaId||!me||!modules.data)return <p role="status">Carregando conversas…</p>;
  if(!modules.data.atendimento_ia||me.role==='analyst')return <p>Conversas indisponíveis para esta empresa ou perfil.</p>;
  return <ConversationsWorkspace key={activeEmpresaId+':'+me.id} />;
}
function ConversationsWorkspace() {
  const { lead } = Route.useSearch();
  const { data: me } = useCrmUser();
  const { activeEmpresaId, isSuperAdmin } = useActiveEmpresa();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [onlyHuman, setOnlyHuman] = useState(false);
  const [projectFilter, setProjectFilter] = useState<{ companyId: number | null; value: string }>({
    companyId: null,
    value: "all",
  });
  // Never reuse a project selection when switching companies.
  const projectId = projectFilter.companyId === activeEmpresaId ? projectFilter.value : "all";
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(!!lead);

  useEffect(() => { setMobileChatOpen(!!lead); }, [lead]);
  const [draft, setDraft] = useState("");
  const pendingTextRequest=useRef<NativeTextRequest|null>(null);
  const [uncertainLeads,setUncertainLeads]=useState<Set<number>>(()=>new Set());

  const projectsQuery = useQuery({
    enabled: !!me && !!activeEmpresaId,
    queryKey: ["conversation-projects", activeEmpresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empreendimento")
        .select("id,nome")
        .eq("id_empresa", activeEmpresaId!)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const conversationsQuery = useQuery({
    enabled: !!me && !!activeEmpresaId,
    queryKey: ["whatsapp-conversations", activeEmpresaId, me?.id, deferredSearch, onlyHuman, projectId],
    refetchInterval: 5_000,
    queryFn: async (): Promise<ConversationItem[]> => {
      const { data, error } = await supabase.rpc("crm_whatsapp_list_conversations_v2", {
        p_id_empresa: activeEmpresaId!,
        p_id_empreendimento: projectId === "all" ? undefined : Number(projectId),
        p_search: deferredSearch || undefined,
        p_only_human: onlyHuman,
        p_limit: 100,
        p_offset: 0,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const requestedContext=useQuery({
    queryKey:['native-conversation-context',activeEmpresaId,me?.id,lead],
    enabled:!!activeEmpresaId&&!!me&&!!lead,
    refetchInterval:5000,
    queryFn:()=>nativeApi.context(activeEmpresaId!,Number(lead)),
  });
  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);
  const conversationLeadIds = useMemo(
    () => conversations.map((conversation) => conversation.lead_id),
    [conversations],
  );
  const windowsQuery = useQuery({
    enabled: !!activeEmpresaId && conversationLeadIds.length > 0,
    queryKey: ["whatsapp-conversation-windows", activeEmpresaId, me?.id, conversationLeadIds],
    refetchInterval: 30_000,
    queryFn: async (): Promise<ConversationWindow[]> => {
      const { data, error } = await supabase.rpc("crm_whatsapp_conversation_windows", {
        p_id_empresa: activeEmpresaId!,
        p_lead_ids: conversationLeadIds,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const windowsByLeadId = useMemo(
    () => new Map((windowsQuery.data ?? []).map((window) => [window.lead_id, window])),
    [windowsQuery.data],
  );
  useEffect(() => {
    setSelectedId(null);
  }, [activeEmpresaId]);

  useEffect(()=>setSelectedId(null),[lead]);
  const selectedConversation = selectNativeConversation(conversations,selectedId,lead,
    requestedContext.isError ? null : (requestedContext.data?.conversation as unknown as ConversationItem) ?? null);

  const messageQuery = useQuery({
    enabled: !!selectedConversation,
    queryKey: ["whatsapp-conversation-messages", activeEmpresaId, me?.id, selectedConversation?.lead_id, lead, selectedId],
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
          .filter(
            (message) =>
              !isToolMessage(message.type, message.message) &&
              !isEmptyInternalAiMessage(message.type, message.message),
          )
          .map((message) => ({
            id: `chat-${message.id}`,
            type: message.type,
            message: message.message,
            time: message.time,
            created_at: message.created_at,
            direction: message.direction,
            source: message.source,
            delivery_status: message.delivery_status,
            error_code: message.error_code,
            error_message: message.error_message,
          }));

      if(lead && selectedId===null){
        const page=await nativeApi.messages(activeEmpresaId!,Number(lead),null,100);
        return sortMessages(mapChatRows(page.items as WhatsappConversationMessageRow[]));
      }
      const { data, error } = await supabase.rpc("crm_whatsapp_conversation_messages_v2", {
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
      if(lead && selectedId===null){
        return nativeApi.attendance(activeEmpresaId!,Number(lead),enabled,force);
      }
      const { data, error } = await supabase.rpc("crm_whatsapp_set_conversation_attendance", {
        p_lead_id: leadId,
        p_enabled: enabled,
        p_force: force,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["native-conversation-context"] });
      queryClient.invalidateQueries({ queryKey: ["leads", "directory"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["lead-activities"] });
      queryClient.invalidateQueries({ queryKey: ["leads-list"] });
      queryClient.invalidateQueries({ queryKey: ["leads-meta"] });
      queryClient.invalidateQueries({ queryKey: ["lead-meta"] });
      queryClient.invalidateQueries({ queryKey: ["lead"] });
      queryClient.invalidateQueries({ queryKey: ["kanban-leads"] });
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
      if(!pendingTextRequest.current || pendingTextRequest.current.leadId!==leadId || pendingTextRequest.current.text!==text)
        pendingTextRequest.current={leadId,text,clientMessageId:crypto.randomUUID()};
      return sendNativeConversationText(supabase,pendingTextRequest.current);
    },
    onSuccess: (_data, variables) => {
      if(pendingTextRequest.current?.leadId===variables.leadId && pendingTextRequest.current?.text===variables.text){
        pendingTextRequest.current=null;
        setDraft(current=>current.trim()===variables.text?'':current);
      }
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversation-messages"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      toast.success("Mensagem aceita pela Meta");
    },
    onError: (error: Error & {deliveryUncertain?:boolean}, variables) => {
      if(error.deliveryUncertain)setUncertainLeads(current=>new Set([...current,variables.leadId]));
      toast.error("Não foi possível confirmar o envio", {description:error.message});
    },
  });

  useEffect(()=>{
    if(requestedContext.isError)toast.error('Não foi possível abrir este lead. Confira a empresa e o vínculo da conversa.');
  },[requestedContext.isError]);
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
  const selectedWindow = selectedConversation
    ? (lead && selectedId===null ? requestedContext.data?.window : windowsByLeadId.get(selectedConversation.lead_id))
    : null;
  const canSendMessage =
    !!selectedConversation?.atendimento_humano &&
    !uncertainLeads.has(selectedConversation.lead_id) &&
    assignedToMe &&
    selectedWindow?.window_open === true;
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
      <div className="hidden items-center justify-between gap-3 md:flex">
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

      <div className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm lg:grid lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className={cn("min-w-0 border-b lg:border-b-0 lg:border-r bg-background/70", mobileChatOpen && selectedConversation ? "hidden lg:block" : "block")}>
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
            {(projectsQuery.data?.length ?? 0) > 1 && (
              <div className="mt-3">
                <Select
                  value={projectId}
                  onValueChange={(value) => {
                    setProjectFilter({ companyId: activeEmpresaId, value });
                    setSelectedId(null);
                    setMobileChatOpen(false);
                  }}
                >
                  <SelectTrigger
                    aria-label="Filtrar por empreendimento"
                    className="w-full min-w-0 [&>span]:truncate"
                  >
                    <SelectValue placeholder="Todos os empreendimentos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os empreendimentos</SelectItem>
                    {(projectsQuery.data ?? []).map((project) => (
                      <SelectItem key={project.id} value={String(project.id)}>
                        {project.nome || `Empreendimento ${project.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {projectsQuery.isError && (
              <button
                type="button"
                className="mt-3 text-sm text-destructive"
                onClick={() => void projectsQuery.refetch()}
              >
                Erro ao carregar empreendimentos. Tentar novamente.
              </button>
            )}
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

          <div className="h-[calc(100dvh-22rem)] min-h-[280px] overflow-y-auto lg:h-[calc(100dvh-230px)]">
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
                  const conversationWindow = windowsByLeadId.get(conversation.lead_id);
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
                      onClick={() => { setSelectedId(conversation.lead_id); setMobileChatOpen(true); }}
                      className={cn(
                        "w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-muted/60",
                        conversation.atendimento_humano
                          ? active
                            ? "bg-violet-100 ring-1 ring-inset ring-violet-300 hover:bg-violet-100 dark:bg-violet-950/50 dark:ring-violet-700"
                            : "bg-violet-50 hover:bg-violet-100 dark:bg-violet-950/30 dark:hover:bg-violet-950/50"
                          : active && "bg-primary/10 hover:bg-primary/10",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <MessageCircle className="h-4 w-4 shrink-0 text-primary" />
                            <p className="truncate font-medium">
                              {conversation.nome || "Sem nome"}
                            </p>
                            {conversationWindow?.window_open ? (
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20"
                                aria-label="Janela de 24 horas aberta"
                                title={`Janela aberta até ${formatDateTime(conversationWindow.window_expires_at)}`}
                              />
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {identity || "Contato sem telefone"}
                          </p>
                          {conversation.atendimento_humano ? (
                            <Badge variant="secondary" className="mt-2 max-w-full truncate">
                              {conversation.assigned_to === me?.id
                                ? "Com você"
                                : conversation.assigned_name
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

        <section className={cn("min-w-0 min-h-0 flex-col md:h-[calc(100dvh-11rem)] md:min-h-[480px] lg:h-[calc(100dvh-160px)] lg:min-h-[640px]", isSuperAdmin ? "h-[calc(100dvh-9rem)] sm:h-[calc(100dvh-5rem)]" : "h-[calc(100dvh-5rem)]", mobileChatOpen && selectedConversation ? "flex" : "hidden lg:flex")}>
          {selectedConversation ? (
            <>
              <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b bg-background px-3 py-2 md:flex md:flex-wrap md:justify-between md:gap-3 md:px-4 md:py-3">
                <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 md:h-11 md:w-11 lg:hidden" aria-label="Voltar para conversas" onClick={() => setMobileChatOpen(false)}>
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary md:h-10 md:w-10">
                    <UserRound className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-semibold">{selectedLeadName}</h2>
                      {selectedConversation.atendimento_humano ? (
                        <Badge className="bg-amber-100 text-[10px] text-amber-800 hover:bg-amber-100 md:text-xs">
                          Atendimento humano
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{selectedLeadIdentity}</p>
                    {assignedToMe || selectedConversation.assigned_name ? (
                      <p className="truncate text-xs text-muted-foreground">
                        Responsável: {assignedToMe ? "você" : selectedConversation.assigned_name}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex max-w-[5rem] flex-wrap items-center justify-end gap-1 md:max-w-none md:gap-2">
                  {selectedCrmLeadId ? (
                    <Button asChild variant="outline" size="sm" className="h-9 w-9 p-0 md:h-8 md:w-auto md:px-3">
                      <Link to="/leads/$id" params={{ id: String(selectedCrmLeadId) }} aria-label="Abrir lead" title="Abrir lead">
                        <span className="sr-only md:not-sr-only">Abrir lead</span>
                        <ArrowUpRight className="h-4 w-4 md:ml-2" />
                      </Link>
                    </Button>
                  ) : null}

                  {selectedWindow &&
                  !selectedWindow.window_open &&
                  (!assignedToOther || canForceAssignment) ? (
                    <ConversationTemplateDialog
                      key={`${activeEmpresaId}:${selectedConversation.lead_id}:template`}
                      leadId={selectedConversation.lead_id}
                      leadName={selectedConversation.nome}
                      companyId={activeEmpresaId!}
                      label={assignedToMe ? "Enviar template" : "Assumir e enviar template"}
                      disabled={attendanceMutation.isPending}
                      compactOnMobile
                      assume={
                        assignedToMe
                          ? undefined
                          : () =>
                              attendanceMutation.mutateAsync({
                                leadId: selectedConversation.lead_id,
                                enabled: true,
                                force: assignedToOther && canForceAssignment,
                              })
                      }
                    />
                  ) : null}

                  {selectedConversation.atendimento_humano && assignedToMe ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 w-9 p-0 md:h-8 md:w-auto md:px-3"
                      aria-label="Devolver para a IA"
                      title="Devolver para a IA"
                      disabled={attendanceMutation.isPending}
                      onClick={() =>
                        attendanceMutation.mutate({
                          leadId: selectedConversation.lead_id,
                          enabled: false,
                        })
                      }
                    >
                      <Bot className="h-4 w-4 md:mr-2" />
                      <span className="sr-only md:not-sr-only">Devolver para a IA</span>
                    </Button>
                  ) : assignedToOther && !canForceAssignment ? (
                    <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0 md:h-8 md:w-auto md:px-3" aria-label="Em atendimento" title="Em atendimento" disabled>
                      <UserRound className="h-4 w-4 md:mr-2" />
                      <span className="sr-only md:not-sr-only">Em atendimento</span>
                    </Button>
                  ) : selectedWindow && !selectedWindow.window_open ? null : (
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 w-9 p-0 md:h-8 md:w-auto md:px-3"
                      aria-label={assignedToOther ? "Assumir deste atendente" : "Assumir conversa"}
                      title={assignedToOther ? "Assumir deste atendente" : "Assumir conversa"}
                      disabled={
                        attendanceMutation.isPending ||
                        windowsQuery.isLoading ||
                        !!windowsQuery.error ||
                        !selectedWindow
                      }
                      onClick={() =>
                        attendanceMutation.mutate({
                          leadId: selectedConversation.lead_id,
                          enabled: true,
                          force: assignedToOther && canForceAssignment,
                        })
                      }
                    >
                      <BotOff className="h-4 w-4 md:mr-2" />
                      <span className="sr-only md:not-sr-only">{assignedToOther ? "Assumir deste atendente" : "Assumir conversa"}</span>
                    </Button>
                  )}
                </div>
              </header>

              <div ref={messagesScrollRef} className="min-h-0 flex-1 overflow-y-auto bg-background p-3 sm:p-4">
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
                      const isOutgoing = message.direction === "outbound" || message.type === "ai";
                      const isHumanAgent = message.source === "hub_human";
                      const deliveryFailed = message.delivery_status === "failed";
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

                          <div className={cn("flex", isOutgoing ? "justify-end" : "justify-start")}>
                            <div
                              className={cn(
                                "max-w-[82%] rounded-2xl px-4 py-2 text-sm shadow-sm md:max-w-[68%]",
                                isOutgoing
                                  ? isHumanAgent
                                    ? "rounded-br-md bg-violet-50 text-foreground dark:bg-violet-950/50"
                                    : "rounded-br-md bg-primary/15 text-foreground"
                                  : "rounded-bl-md bg-white text-foreground",
                                deliveryFailed && "border border-destructive/50 bg-destructive/10",
                              )}
                            >
                              {getConversationAttachment(message.message)
                                ? <ConversationAttachment attachment={getConversationAttachment(message.message)!} />
                                : <MessageContent text={text || "Mensagem sem conteúdo"} />}
                              {deliveryFailed && message.error_code === "131049" && (
                                <p className="mt-3 border-t border-amber-400/40 pt-2 text-xs leading-relaxed" role="status">
                                  A Meta restringiu temporariamente a entrega desta mensagem para proteger
                                  a experiência no WhatsApp (131049). O HUB pausa novos templates de
                                  marketing para este contato por 24 horas a partir da recusa.
                                  Consulte o horário em “Enviar template”. Após esse prazo, a entrega
                                  ainda depende da Meta.
                                </p>
                              )}
                              <div
                                className={cn(
                                  "mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground",
                                  deliveryFailed && "text-destructive",
                                )}
                                title={message.error_message || undefined}
                              >
                                {deliveryFailed ? (
                                  <CircleAlert className="h-3 w-3" />
                                ) : isHumanAgent ? (
                                  <UserRound className="h-3 w-3" />
                                ) : isOutgoing ? (
                                  <Bot className="h-3 w-3" />
                                ) : null}
                                {formatTime(message.time ?? message.created_at)}
                                {isHumanAgent && message.delivery_status ? (
                                  <span className="ml-1 inline-flex items-center gap-1">
                                    {deliveryFailed ? (
                                      message.error_code === "131049" ? "Entrega restringida pela Meta (131049)" : `Falha no envio${message.error_code ? ` (${message.error_code})` : ""}`
                                    ) : (
                                      <>
                                        <CheckCheck className="h-3 w-3" />
                                        {message.delivery_status === "read"
                                          ? "Lida"
                                          : message.delivery_status === "delivered"
                                            ? "Entregue"
                                            : "Enviada"}
                                      </>
                                    )}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <footer className="shrink-0 space-y-3 border-t bg-background px-3 py-3 sm:px-4">
                <div className="flex items-center gap-2">
                  {uncertainLeads.has(selectedConversation.lead_id)&&<p role="alert" className="text-sm text-destructive">O envio pode ter ocorrido. Não repita a mensagem; confira a entrega e o histórico antes de continuar.</p>}
                  <ConversationAttachmentComposer key={selectedConversation.lead_id} leadId={selectedConversation.lead_id} canSend={canSendMessage} onSent={()=>{
                    queryClient.invalidateQueries({queryKey:["whatsapp-conversation-messages"]});
                    queryClient.invalidateQueries({queryKey:["whatsapp-conversations"]});
                  }}/>
                  <p className="text-xs text-muted-foreground">JPG/PNG até 5 MB · PDF até 100 MB. Anexos exigem janela de 24h aberta.</p>
                </div>
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
                      <div className="mt-1 flex justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>
                          Mensagem livre disponível dentro da janela de atendimento da Meta.
                        </span>
                        <span className="shrink-0">{draft.length}/4096</span>
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
                      : assignedToMe && windowsQuery.isLoading
                        ? "Verificando a janela de atendimento da Meta..."
                        : assignedToMe && !selectedWindow?.window_open
                          ? "A janela de 24 horas está fechada. Envie um template e aguarde o cliente responder para enviar mensagens livres."
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

