import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link2, RefreshCw } from "lucide-react";
import {PermanentHistoryLink} from "./permanent-history-link";
import { Button } from "@/components/ui/button";
import { db } from "@/hml/modules";

export type ConversationMessage = {
  id: number | string;
  sender: "contact" | "assistant" | "human";
  body: string;
  sent_at: string;
  delivery_status?: string | null;
};
export type HistoryCursor = { sent_at: string; source: string; source_id: string };
const formatDate = (value: string) =>
  !value || Number.isNaN(Date.parse(value)) ? 'Data indisponível' :
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
const senderNames = { contact: "Lead", assistant: "Atendimento IA", human: "Equipe" };

export function Transcript({ messages }: { messages: ConversationMessage[] }) {
  return (
    <ol aria-label="Mensagens da conversa" className="space-y-4">
      {messages.map((message) => (
        <li
          key={message.id}
          className={`flex ${message.sender === "contact" ? "justify-start" : "justify-end"}`}
        >
          <article
            className={`max-w-[90%] rounded-xl border p-3 sm:max-w-[80%] ${message.sender === "contact" ? "bg-background" : "bg-primary/5"}`}
          >
            <header className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <strong>{senderNames[message.sender]}</strong>
              <time className="text-muted-foreground" dateTime={message.sent_at}>
                {formatDate(message.sent_at)}
              </time>
            </header>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
              {message.body}
            </p>
            {message.delivery_status && (
              <p className="mt-2 text-xs text-muted-foreground">
                {{ accepted: "Aceita pelo provedor", sent: "Enviada", delivered: "Entregue", read: "Lida", failed: "Falha no envio", pending: "Pendente" }[message.delivery_status] ?? message.delivery_status}
              </p>
            )}
          </article>
        </li>
      ))}
    </ol>
  );
}

export function ConversationPanel({
  companyId,
  leadId,
  name,
  actorId,
  canShare,
  initialShare,
}: {
  companyId: number;
  leadId: number;
  name: string;
  actorId: string;
  canShare: boolean;
  initialShare: boolean;
}) {
  const [sharing, setSharing] = useState(initialShare);
  const query = useInfiniteQuery({
    queryKey: ["conversation", companyId, leadId, actorId],
    initialPageParam: null as HistoryCursor | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await db.rpc("hub_conversation_transcript", {
        p_company: companyId, p_lead: leadId, p_cursor: pageParam, p_limit: 50,
      });
      if (error) throw error;
      return data as { items: ConversationMessage[]; next: HistoryCursor | null };
    },
    getNextPageParam: (page) => page.next,
    refetchOnWindowFocus: true,
  });
  const messages = query.data?.pages.flatMap((page) => page.items).reverse() ?? [];
  return (
    <section className="space-y-4">
      <header>
        <h2 className="font-semibold">Conversa · {name}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Homologação · horário de Brasília.
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => query.refetch()}
        >
          <RefreshCw size={14} />
          Atualizar conversa
        </Button>
        {canShare && (
          <Button variant="outline" size="sm" onClick={() => setSharing((v) => !v)}>
            <Link2 size={14} />
            Compartilhar histórico
          </Button>
        )}
      </div>
      {sharing && canShare && <PermanentHistoryLink companyId={companyId} leadId={leadId} onClose={()=>setSharing(false)} />}
      {query.isPending ? (
        <p role="status" className="py-8 text-center text-sm">
          Carregando conversa…
        </p>
      ) : query.isError ? (
        <p role="alert" className="py-6 text-sm text-destructive">
          Não foi possível carregar a conversa. Use Atualizar para tentar novamente.
        </p>
      ) : !messages.length ? (
        <div className="rounded-xl border p-8 text-center">
          <p className="font-medium">Nenhuma mensagem disponível</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Este lead ainda não tem uma conversa de demonstração acessível nesta empresa.
          </p>
        </div>
      ) : (
        <>
          <div className="text-center">
            {query.hasNextPage && (
              <Button
                variant="ghost"
                disabled={query.isFetchingNextPage}
                onClick={() => query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? "Carregando…" : "Carregar mensagens anteriores"}
              </Button>
            )}
          </div>
          <Transcript messages={messages} />
        </>
      )}
    </section>
  );
}

