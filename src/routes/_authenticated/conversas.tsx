import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  Flame,
  Inbox,
  MessageCircle,
  MessagesSquare,
  Search,
  UserRound,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { useCrmUser } from "@/hooks/use-crm-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/conversas")({
  component: ConversationsPage,
});

type LeadConversationRow = Database["public"]["Tables"]["lead"]["Row"];
type ChatConversationRow = Database["public"]["Tables"]["n8n_chat_conversas"]["Row"];
type LeadActivityRow = Pick<
  Database["public"]["Tables"]["crm_lead_activities"]["Row"],
  "id" | "descricao" | "created_at" | "tipo"
>;

type CrmLeadLite = {
  id: number;
  nome: string;
  telefone: string;
  email: string | null;
  crm_assigned_to: string | null;
  lead_quente: boolean | null;
};

type ConversationItem = LeadConversationRow & {
  crmLead: CrmLeadLite | null;
};

type ConversationMessage = {
  id: string;
  type: string | null;
  message: Json | null;
  time: string | null;
  created_at: string | null;
};

const ACTIVITY_BLOCK_MARKERS = [
  "Mensagem recebida do lead:",
  "Resposta enviada pela IA:",
  "Mensagem enviada pela IA:",
  "Mensagem enviada ao lead:",
  "Mensagem enviada:",
];

function onlyDigits(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

function phoneVariants(value?: string | null) {
  const digits = onlyDigits(value);
  if (!digits) return [];
  return Array.from(new Set([digits, digits.length > 11 ? digits.slice(-11) : digits]));
}

function crmLeadId(value?: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sessionCandidates(conversation: ConversationItem) {
  const numbers = [
    ...phoneVariants(conversation.numero),
    ...phoneVariants(conversation.crmLead?.telefone),
  ];

  return Array.from(
    new Set(
      numbers.flatMap((number) => [
        `${number}${conversation.id_empresa}`,
        number,
      ]),
    ),
  );
}

function messageToText(message: Json | null) {
  if (message == null) return "";
  if (typeof message === "string") return message;
  if (typeof message === "number" || typeof message === "boolean") return String(message);
  if (Array.isArray(message)) return message.map((item) => messageToText(item)).filter(Boolean).join("\n");

  const record = message as Record<string, Json>;
  const preferredKeys = ["content", "text", "message", "output", "body"];
  for (const key of preferredKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return JSON.stringify(message);
}

function extractActivityBlock(text: string, marker: string) {
  const start = text.indexOf(marker);
  if (start < 0) return null;

  let body = text.slice(start + marker.length);
  body = body.replace(/^\s*\n?-{3,}\n?/, "");

  const nextIndexes = ACTIVITY_BLOCK_MARKERS
    .filter((candidate) => candidate !== marker)
    .map((candidate) => body.indexOf(candidate))
    .filter((index) => index >= 0);

  const end = nextIndexes.length ? Math.min(...nextIndexes) : body.length;
  const value = body.slice(0, end).replace(/-{3,}\s*$/, "").trim();
  return value || null;
}

function activityToConversationMessages(activity: LeadActivityRow): ConversationMessage[] {
  const description = activity.descricao ?? "";
  if (!description.trim()) return [];

  const humanMessage = extractActivityBlock(description, "Mensagem recebida do lead:");
  const aiMessage =
    extractActivityBlock(description, "Resposta enviada pela IA:") ??
    extractActivityBlock(description, "Mensagem enviada pela IA:") ??
    extractActivityBlock(description, "Mensagem enviada ao lead:") ??
    extractActivityBlock(description, "Mensagem enviada:");

  const messages: ConversationMessage[] = [];
  if (humanMessage) {
    messages.push({
      id: `activity-${activity.id}-human`,
      type: "human",
      message: humanMessage,
      time: activity.created_at,
      created_at: activity.created_at,
    });
  }

  if (aiMessage) {
    messages.push({
      id: `activity-${activity.id}-ai`,
      type: "ai",
      message: aiMessage,
      time: activity.created_at,
      created_at: activity.created_at,
    });
  }

  return messages;
}

function parseDateValue(value?: string | number | null) {
  if (!value) return "—";
  const raw = String(value).trim();
  if (!raw) return "—";

  const numeric = Number(raw);
  const date = Number.isFinite(numeric) && /^\d+$/.test(raw)
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
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }) + " " + date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timestampMs(value?: string | null) {
  const date = parseDateValue(value);
  return !date || date === "—" ? 0 : date.getTime();
}

function conversationTimestamp(row: LeadConversationRow) {
  return row.last_message_timestamp ?? row.updated_at ?? row.created_at ?? "";
}

function previewText(row: ConversationItem) {
  const value = row.ult_message ?? row.last_mesage;
  if (!value) return null;
  return parseDateValue(value) ? null : value;
}

function ConversationsPage() {
  const { data: me } = useCrmUser();
  const { data: allowed } = useAllowedEmpresas();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const conversationsQuery = useQuery({
    enabled: !!me && !!allowed?.length,
    queryKey: ["conversations", allowed],
    queryFn: async (): Promise<ConversationItem[]> => {
      const { data: leadRows, error } = await supabase
        .from("lead")
        .select(
          "id,id_empresa,nome,numero,email,id_crm,lead_quente,qtd_interacoes,ult_message,last_mesage,last_message_timestamp,crm_assigned_to,created_at,updated_at",
        )
        .in("id_empresa", allowed ?? []);

      if (error) throw error;

      const rows = ((leadRows ?? []) as LeadConversationRow[])
        .filter((row) => row.id_crm || row.numero)
        .sort((a, b) => timestampMs(conversationTimestamp(b)) - timestampMs(conversationTimestamp(a)));

      const crmIds = Array.from(new Set(rows.map((row) => crmLeadId(row.id_crm)).filter((id): id is number => id != null)));
      let crmMap = new Map<number, CrmLeadLite>();

      if (crmIds.length) {
        const { data: crmRows, error: crmError } = await supabase
          .from("crm_leads")
          .select("id,nome,telefone,email,crm_assigned_to,lead_quente")
          .in("id", crmIds);

        if (crmError) throw crmError;
        crmMap = new Map((crmRows ?? []).map((row) => [row.id, row as CrmLeadLite]));
      }

      return rows
        .map((row) => ({
          ...row,
          crmLead: crmMap.get(crmLeadId(row.id_crm) ?? 0) ?? null,
        }))
        .filter((row) => row.crmLead);
    },
  });

  const conversations = conversationsQuery.data ?? [];
  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((item) => {
      const fields = [
        item.nome,
        item.numero,
        item.email,
        item.crmLead?.nome,
        item.crmLead?.telefone,
        item.crmLead?.email,
        item.ult_message,
        item.last_mesage,
      ];
      return fields.some((field) => (field ?? "").toLowerCase().includes(term));
    });
  }, [conversations, search]);

  const selectedConversation = useMemo(() => {
    if (!filteredConversations.length) return null;
    return filteredConversations.find((item) => item.id === selectedId) ?? filteredConversations[0];
  }, [filteredConversations, selectedId]);

  const messageQuery = useQuery({
    enabled: !!selectedConversation,
    queryKey: ["conversation-messages", selectedConversation?.id, selectedConversation?.numero, selectedConversation?.id_empresa],
    queryFn: async (): Promise<ConversationMessage[]> => {
      if (!selectedConversation) return [];
      const candidates = sessionCandidates(selectedConversation);

      if (candidates.length) {
        const phoneFilters = phoneVariants(selectedConversation.numero || selectedConversation.crmLead?.telefone)
          .map((phone) => `numero.ilike.%${phone}%`);
        const exactFilters = candidates.map((candidate) => `numero.eq.${candidate}`);
        const filters = [...exactFilters, ...phoneFilters].join(",");

        const { data, error } = await supabase
          .from("n8n_chat_conversas")
          .select("id,numero,type,message,time,created_at")
          .or(filters)
          .order("time", { ascending: true });

        if (error) throw error;

        const messages = ((data ?? []) as ChatConversationRow[]).map((message) => ({
          id: `chat-${message.id}`,
          type: message.type,
          message: message.message,
          time: message.time,
          created_at: message.created_at,
        }));

        if (messages.length) return messages;
      }

      if (!selectedConversation.crmLead?.id) return [];

      const { data: activityRows, error: activityError } = await supabase
        .from("crm_lead_activities")
        .select("id,tipo,descricao,created_at")
        .eq("lead_id", selectedConversation.crmLead.id)
        .eq("tipo", "whatsapp_automation")
        .order("created_at", { ascending: true });

      if (activityError) throw activityError;

      return ((activityRows ?? []) as LeadActivityRow[]).flatMap(activityToConversationMessages);
    },
  });

  const selectedLeadName = selectedConversation?.crmLead?.nome ?? selectedConversation?.nome ?? "Conversa";
  const selectedLeadPhone = selectedConversation?.crmLead?.telefone ?? selectedConversation?.numero ?? "Sem telefone";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Conversas</h1>
          <p className="text-sm text-muted-foreground">Histórico de atendimento dos leads pela IA.</p>
        </div>
        <Badge variant="outline" className="hidden sm:inline-flex">
          {filteredConversations.length} conversa{filteredConversations.length === 1 ? "" : "s"}
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
                placeholder="Pesquisar conversa"
                className="pl-9"
              />
            </div>
          </div>

          <div className="h-[280px] overflow-y-auto lg:h-[calc(100vh-230px)]">
            {conversationsQuery.isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Carregando conversas...</div>
            ) : conversationsQuery.error ? (
              <div className="p-4 text-sm text-destructive">Erro ao carregar conversas.</div>
            ) : !filteredConversations.length ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8" />
                Nenhuma conversa encontrada.
              </div>
            ) : (
              <div className="divide-y">
                {filteredConversations.map((conversation) => {
                  const active = selectedConversation?.id === conversation.id;
                  const name = conversation.crmLead?.nome ?? conversation.nome;
                  const phone = conversation.crmLead?.telefone ?? conversation.numero;
                  const preview = previewText(conversation);

                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => setSelectedId(conversation.id)}
                      className={cn(
                        "w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-muted/60",
                        active && "bg-primary/10 hover:bg-primary/10",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <MessageCircle className="h-4 w-4 shrink-0 text-primary" />
                            <p className="truncate font-medium">{name || "Sem nome"}</p>
                            {conversation.lead_quente || conversation.crmLead?.lead_quente ? (
                              <Flame className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{phone || "Sem telefone"}</p>
                          {preview ? (
                            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{preview}</p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                          <div>{formatDateTime(conversation.last_message_timestamp ?? conversation.updated_at)}</div>
                          {conversation.qtd_interacoes ? (
                            <Badge variant="secondary" className="mt-2">
                              {conversation.qtd_interacoes}
                            </Badge>
                          ) : null}
                          {conversation.crmLead?.id ? (
                            <div className="mt-2 font-medium">#{conversation.crmLead.id}</div>
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
                      {selectedConversation.lead_quente || selectedConversation.crmLead?.lead_quente ? (
                        <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">Quente</Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{selectedLeadPhone}</p>
                  </div>
                </div>

                {selectedConversation.crmLead?.id ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to="/leads/$id" params={{ id: String(selectedConversation.crmLead.id) }}>
                      Abrir lead
                      <ArrowUpRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                ) : null}
              </header>

              <div
                className="flex-1 overflow-y-auto p-4"
                style={{
                  backgroundColor: "#F7F2EA",
                  backgroundImage:
                    "linear-gradient(45deg, rgba(193,79,33,0.035) 25%, transparent 25%), linear-gradient(-45deg, rgba(193,79,33,0.035) 25%, transparent 25%)",
                  backgroundSize: "28px 28px",
                }}
              >
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
                    {messageQuery.data.map((message) => {
                      const isAi = message.type === "ai";
                      const text = messageToText(message.message);

                      return (
                        <div key={message.id} className={cn("flex", isAi ? "justify-end" : "justify-start")}>
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
                      );
                    })}
                  </div>
                )}
              </div>

              <footer className="border-t bg-background px-4 py-3 text-xs text-muted-foreground">
                Última mensagem: {formatDateTime(selectedConversation.last_message_timestamp ?? selectedConversation.updated_at)}
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
  const parts = text.split(/(\[IMG:[^\]\s]+\])/g);

  return (
    <div className="space-y-2 leading-relaxed">
      {parts.map((part, index) => {
        const match = part.match(/^\[IMG:([^\]\s]+)\]$/);
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
