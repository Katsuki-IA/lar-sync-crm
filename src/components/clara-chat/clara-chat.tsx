import { useEffect, useRef, useState } from "react";
import { ArrowUp, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Msg = { id: number | string; role: "user" | "assistant"; content: string; pendingId?: string; failed?: boolean };
type Config = { assistant_name: string; avatar_url: string | null; avatar_fallback: string };
const API = "/api/public/clara-chat";
const GREET_KEY = "clara-greeting-request";

const ERRORS: Record<string, string> = {
  rate_limited: "Muitas mensagens em pouco tempo. Aguarde alguns minutos e tente de novo.",
  busy: "A Clara ainda está respondendo a mensagem anterior.",
  ai_not_configured: "O chat está temporariamente indisponível.",
  disabled: "O chat está temporariamente indisponível.",
};

async function post(requestId: string, kind: "greeting" | "message", text?: string) {
  const res = await fetch(API, {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, kind, text }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data?.status === "done", data };
}

export function ClaraChat() {
  const [config, setConfig] = useState<Config | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(API, { credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (data?.status !== "ok") { setState("unavailable"); setError(ERRORS[data?.status] ?? "O chat está temporariamente indisponível."); return; }
      setConfig(data.config); setMessages(data.messages ?? []); setState("ready");
      if (!data.greeted) {
        // Mesmo requestId em recargas/retries: a abertura acontece uma vez.
        const rid = sessionStorage.getItem(GREET_KEY) ?? crypto.randomUUID();
        sessionStorage.setItem(GREET_KEY, rid);
        setSending(true);
        const r = await post(rid, "greeting");
        if (cancelled) return;
        setSending(false);
        if (r.ok && r.data.reply) setMessages((m) => m.some((x) => x.id === r.data.reply.id) ? m : [...m, r.data.reply]);
        else if (!r.ok) setError(ERRORS[r.data?.status] ?? null);
      }
      inputRef.current?.focus();
    })().catch(() => { if (!cancelled) { setState("unavailable"); setError("Não foi possível abrir o chat."); } });
    return () => { cancelled = true; };
  }, []);

  const send = async (content: string, requestId: string) => {
    setSending(true); setError(null);
    setMessages((m) => m.some((x) => x.pendingId === requestId)
      ? m.map((x) => x.pendingId === requestId ? { ...x, failed: false } : x)
      : [...m, { id: requestId, role: "user", content, pendingId: requestId }]);
    try {
      const r = await post(requestId, "message", content);
      if (r.ok) {
        setMessages((m) => [...m.map((x) => x.pendingId === requestId ? { ...x, pendingId: undefined } : x), r.data.reply]);
      } else {
        setMessages((m) => m.map((x) => x.pendingId === requestId ? { ...x, failed: true } : x));
        setError(ERRORS[r.data?.status] ?? "Não foi possível enviar. Toque em tentar de novo.");
      }
    } catch {
      setMessages((m) => m.map((x) => x.pendingId === requestId ? { ...x, failed: true } : x));
      setError("Sem conexão. Toque em tentar de novo.");
    } finally { setSending(false); inputRef.current?.focus(); }
  };

  const submit = () => {
    const v = text.trim();
    if (!v || sending || state !== "ready") return;
    setText(""); void send(v, crypto.randomUUID());
  };

  const name = config?.assistant_name ?? "Clara";
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Avatar config={config} />
          <div>
            <h1 className="text-base font-semibold leading-tight">{name}</h1>
            <p className="text-xs text-muted-foreground">Katsuki · atendimento online</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-3 px-4 py-6" aria-live="polite">
        {state === "loading" && <p className="text-center text-sm text-muted-foreground">Abrindo conversa…</p>}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex items-end gap-2"}>
            {m.role === "assistant" && <Avatar config={config} small />}
            <div className={m.role === "user"
              ? "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground"
              : "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm"}>
              {m.content}
              {m.failed && (
                <button type="button" className="mt-1 flex items-center gap-1 text-xs underline" disabled={sending}
                  onClick={() => void send(m.content, String(m.pendingId))}>
                  <RotateCw className="size-3" /> Tentar de novo
                </button>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex items-end gap-2" aria-label={`${name} está digitando`}>
            <Avatar config={config} small />
            <div className="flex gap-1 rounded-2xl bg-muted px-4 py-3">
              {[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 120}ms` }} />)}
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-center text-sm text-destructive">{error}</p>}
        <div ref={endRef} />
      </main>

      <footer className="sticky bottom-0 border-t bg-background pb-[env(safe-area-inset-bottom)]">
        <form className="mx-auto flex max-w-2xl items-end gap-2 px-4 py-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Textarea ref={inputRef} value={text} rows={1} maxLength={2000} disabled={state !== "ready"}
            placeholder="Escreva sua mensagem" aria-label="Mensagem" className="max-h-40 min-h-11 resize-none"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <Button type="submit" size="icon" className="size-11 shrink-0" aria-label="Enviar" disabled={!text.trim() || sending || state !== "ready"}>
            <ArrowUp className="size-5" />
          </Button>
        </form>
      </footer>
    </div>
  );
}

function Avatar({ config, small }: { config: Config | null; small?: boolean }) {
  const size = small ? "size-7 text-xs" : "size-10 text-sm";
  if (config?.avatar_url) return <img src={config.avatar_url} alt={config.assistant_name} className={`${size} shrink-0 rounded-full object-cover`} />;
  return <span aria-hidden className={`${size} flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground`}>{config?.avatar_fallback ?? "C"}</span>;
}
