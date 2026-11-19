import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { canSeeWebChat, CLARA_EMPRESA_ID } from "@/lib/clara-chat";

export const Route = createFileRoute("/_authenticated/chat-web")({
  head: () => ({ meta: [{ title: "Chat web | Katsuki HUB" }, { name: "robots", content: "noindex" }] }),
  component: ChatWebPage,
});

type Session = {
  id: string; contact: { nome?: string; email?: string; telefone?: string }; crm_status: "none" | "promoted" | "phone_conflict";
  crm_lead_id: number | null; last_seen_at: string; total_mensagens: number; ultima_mensagem: string | null;
};
type Msg = { id: number; role: "user" | "assistant"; content: string; created_at: string };
// RPCs do candidato ainda não estão nos tipos gerados.
const rpc = supabase as unknown as { rpc(n: string, a: Record<string, unknown>): Promise<{ data: unknown; error: { message: string; code?: string } | null }> };

const STATUS: Record<Session["crm_status"], string> = {
  none: "Só no chat",
  promoted: "Lead no CRM",
  phone_conflict: "Telefone já existe no CRM",
};
const fmt = (v: string) => new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

function ChatWebPage() {
  const { data: me } = useCrmUser();
  const { activeEmpresaId } = useActiveEmpresa();
  const allowed = canSeeWebChat(me?.role, activeEmpresaId);
  const [selected, setSelected] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ["web-chat-sessions", CLARA_EMPRESA_ID],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await rpc.rpc("web_chat_hub_sessions", { p_empresa: CLARA_EMPRESA_ID, p_limit: 50, p_offset: 0 });
      if (error?.code === "PGRST202") return null;
      if (error) throw error;
      return (data ?? []) as Session[];
    },
  });
  const messages = useQuery({
    queryKey: ["web-chat-messages", selected],
    enabled: allowed && !!selected,
    queryFn: async () => {
      const { data, error } = await rpc.rpc("web_chat_hub_messages", { p_empresa: CLARA_EMPRESA_ID, p_session: selected });
      if (error) throw error;
      return (data ?? []) as Msg[];
    },
  });

  if (!allowed) return <p className="p-6 text-sm text-muted-foreground">Esta seção é exclusiva da empresa Katsuki para gestores e super admin.</p>;

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Chat web</h1>
        <p className="text-sm text-muted-foreground">Conversas da Clara no site. Leads com telefone informado entram no CRM com origem Site (Chat web).</p>
      </header>
      {sessions.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {sessions.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar as conversas.</p>}
      {sessions.data === null && <p className="text-sm text-muted-foreground">O chat web ainda não foi instalado no banco.</p>}
      {sessions.data && sessions.data.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma conversa ainda.</p>}
      {sessions.data && sessions.data.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <ul className="divide-y rounded-lg border">
            {sessions.data.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setSelected(s.id)}
                  className={`w-full px-4 py-3 text-left hover:bg-muted ${selected === s.id ? "bg-muted" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{s.contact?.nome ?? "Visitante anônimo"}</span>
                    <span className="text-xs text-muted-foreground">{fmt(s.last_seen_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[s.contact?.email, s.contact?.telefone].filter(Boolean).join(" · ") || "Sem contato"} · {STATUS[s.crm_status]}
                    {s.crm_lead_id ? ` #${s.crm_lead_id}` : ""} · {s.total_mensagens} mensagens
                  </p>
                  {s.ultima_mensagem && <p className="mt-1 line-clamp-2 text-sm">{s.ultima_mensagem}</p>}
                </button>
              </li>
            ))}
          </ul>
          <section className="space-y-2 rounded-lg border p-4" aria-label="Mensagens da conversa">
            {!selected && <p className="text-sm text-muted-foreground">Selecione uma conversa.</p>}
            {messages.data?.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex"}>
                <p className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{m.content}</p>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
