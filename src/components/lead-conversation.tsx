import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { db, secondaryClass } from "@/hml/modules";
import { nativeConversationApi } from "@/hml/native-conversation-api";
import type { Json } from "@/integrations/supabase/types";
import { ConversationAudio } from "./conversation-audio";
import { getConversationAttachment, ConversationAttachment } from "./conversation-attachment";
import {
  messageToText,
  isToolMessage,
  isEmptyInternalAiMessage,
  parseDateValue,
  MessageContent,
} from "./conversation-message-content";
const api = nativeConversationApi(db);

export function LeadConversation({
  companyId,
  leadId,
  actorId,
}: {
  companyId: number;
  leadId: number;
  actorId: string;
}) {
  const context = useQuery({
    queryKey: ["opportunity-conversation-context", companyId, leadId, actorId],
    queryFn: () => api.context(companyId, leadId),
    retry: false,
  });
  const history = useInfiniteQuery({
    queryKey: [
      "opportunity-conversation-messages",
      companyId,
      leadId,
      actorId,
      context.data?.lead_id,
    ],
    enabled: !!context.data,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => api.messages(companyId, leadId, pageParam),
    getNextPageParam: (page) => page.next,
    refetchInterval: 30000,
  });
  const rows = (history.data?.pages.flatMap((p) => p.items) ?? [])
    .reverse()
    .filter(
      (row) =>
        !isToolMessage(row.type, row.message as Json) &&
        !isEmptyInternalAiMessage(row.type, row.message as Json),
    );
  const unavailable = (context.error as { code?: string } | null)?.code === "PT409";
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Conversa do lead</h2>
        {context.data && (
          <Link
            className="text-sm text-primary underline"
            to="/conversas"
            search={{ lead: String(leadId) }}
          >
            Abrir em Conversas
          </Link>
        )}
      </header>
      {unavailable ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma conversa vinculada de forma Ãºnica a este lead.
        </p>
      ) : context.isError || history.isError ? (
        <div role="alert">
          NÃ£o foi possÃ­vel carregar a conversa.{" "}
          <button
            className={secondaryClass}
            onClick={() => (context.isError ? context.refetch() : history.refetch())}
          >
            Tentar novamente
          </button>
        </div>
      ) : history.isPending ? (
        <p role="status">Carregando conversaâ€¦</p>
      ) : (
        <div className="max-h-[32rem] space-y-3 overflow-y-auto rounded-lg bg-muted/50 p-3">
          {history.hasNextPage && (
            <button
              className={secondaryClass}
              disabled={history.isFetchingNextPage}
              onClick={() => history.fetchNextPage()}
            >
              Carregar mensagens anteriores
            </button>
          )}
          {!rows.length && (
            <p className="text-sm text-muted-foreground">Nenhuma mensagem disponÃ­vel.</p>
          )}
          {rows.map((row) => {
            const data = row.message as Json;
            const text = messageToText(data);
            const attachment = getConversationAttachment(data);
            const outgoing = row.direction === "outbound" || row.type === "ai";
            const date = parseDateValue(row.time ?? row.created_at);
            return (
              <article
                key={row.id}
                className={
                  "w-fit max-w-[90%] space-y-1 rounded-xl border p-3 text-sm " +
                  (outgoing ? "ml-auto bg-primary/5" : "bg-card")
                }
              >
                <p className="text-xs text-muted-foreground">
                  {row.source === "hub_human" ? "Equipe" : outgoing ? "Atendimento IA" : "Lead"} Â·{" "}
                  {date instanceof Date ? date.toLocaleString("pt-BR") : "Data indisponÃ­vel"}
                </p>
                {text.trim().toLowerCase() === "[audio]" && context.data ? (
                  <ConversationAudio leadId={context.data.lead_id} chatId={"chat-" + row.id} />
                ) : attachment ? (
                  <ConversationAttachment attachment={attachment} />
                ) : (
                  <MessageContent text={text} />
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
