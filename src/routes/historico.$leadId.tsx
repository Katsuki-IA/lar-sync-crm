import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Bot, Building2, Copy, LockKeyhole, Mail, Phone, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { formatLeadOrigin } from "@/lib/lead-origin";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/historico/$leadId")({
  component: PublicLeadHistoryPage,
});

type PublicLeadHistoryPayload = {
  lead: {
    id: number;
    id_empresa: number;
    historico_token: string | null;
    empresa_nome: string | null;
    nome: string | null;
    telefone: string | null;
    email: string | null;
    origem: string | null;
    id_empreendimento: number | null;
    empreendimento_nome: string | null;
    created_at: string | null;
  };
  messages: ConversationMessage[];
  activities: LeadActivity[];
};

type ConversationMessage = {
  id: string;
  type: string | null;
  message: Json | null;
  time: string | null;
  created_at: string | null;
};

type LeadActivity = {
  id: number;
  tipo: string | null;
  descricao: string | null;
  created_at: string | null;
};

const ACTIVITY_BLOCK_MARKERS = [
  "Mensagem recebida do lead:",
  "Resposta enviada pela IA:",
  "Mensagem enviada pela IA:",
  "Mensagem enviada ao lead:",
  "Mensagem enviada:",
];

function messageToText(message: Json | null) {
  if (message == null) return "";
  if (typeof message === "string") return message;
  if (typeof message === "number" || typeof message === "boolean") return String(message);
  if (Array.isArray(message)) return message.map((item) => messageToText(item)).filter(Boolean).join("\n");

  const record = message as Record<string, Json>;
  for (const key of ["content", "text", "message", "output", "body"]) {
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

function activityToConversationMessages(activity: LeadActivity): ConversationMessage[] {
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
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const numeric = Number(raw);
  const date = Number.isFinite(numeric) && /^\d+$/.test(raw)
    ? new Date(raw.length <= 10 ? numeric * 1000 : numeric)
    : new Date(raw);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value?: string | number | null) {
  const date = parseDateValue(value);
  if (!date) return "—";
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
  return parseDateValue(value)?.getTime() ?? 0;
}

function PublicLeadHistoryPage() {
  const { leadId } = Route.useParams();
  const leadRef = leadId.trim();
  const validLeadRef = leadRef.length > 0;
  const [digits, setDigits] = useState(["", "", "", ""]);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const code = digits.join("");

  const historyQuery = useQuery({
    enabled: validLeadRef && code.length === 4,
    queryKey: ["public-lead-history", leadRef, code],
    queryFn: async (): Promise<PublicLeadHistoryPayload | null> => {
      const { data, error } = await supabase.rpc("crm_public_lead_history", {
        p_lead_ref: leadRef,
        p_codigo: code,
      });
      if (error) throw error;
      return data as PublicLeadHistoryPayload | null;
    },
    retry: false,
  });

  const payload = historyQuery.data ?? null;
  const messages = useMemo(() => {
    if (!payload) return [];
    const source = payload.messages?.length
      ? payload.messages
      : (payload.activities ?? []).flatMap(activityToConversationMessages);

    return [...source].sort(
      (a, b) => timestampMs(a.time ?? a.created_at) - timestampMs(b.time ?? b.created_at),
    );
  }, [payload]);

  function updateDigit(index: number, value: string) {
    const nextValue = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = nextValue;
    setDigits(next);
    if (nextValue && index < 3) inputs.current[index + 1]?.focus();
  }

  function handlePaste(value: string) {
    const pasted = value.replace(/\D/g, "").slice(0, 4).split("");
    if (!pasted.length) return;
    setDigits([pasted[0] ?? "", pasted[1] ?? "", pasted[2] ?? "", pasted[3] ?? ""]);
    inputs.current[Math.min(pasted.length, 4) - 1]?.focus();
  }

  async function copyPhone(phone?: string | null) {
    if (!phone) return;
    await navigator.clipboard.writeText(phone);
  }

  if (!validLeadRef) {
    return (
      <AccessShell>
        <p className="text-center text-sm text-muted-foreground">Link de histórico inválido.</p>
      </AccessShell>
    );
  }

  if (!payload) {
    const invalidCode = code.length === 4 && historyQuery.isSuccess && !historyQuery.data;
    return (
      <AccessShell>
        <div className="mx-auto max-w-md text-center">
          <p className="text-sm text-muted-foreground">
            Digite o <strong className="text-foreground">código de 4 dígitos</strong> do HUB Katsuki
          </p>

          <div className="mt-8 flex justify-center gap-2">
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(input) => {
                  inputs.current[index] = input;
                }}
                value={digit}
                inputMode="numeric"
                maxLength={1}
                onPaste={(event) => {
                  event.preventDefault();
                  handlePaste(event.clipboardData.getData("text"));
                }}
                onChange={(event) => updateDigit(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && !digits[index] && index > 0) {
                    inputs.current[index - 1]?.focus();
                  }
                }}
                className="h-16 w-14 rounded-lg border bg-background text-center text-2xl font-semibold outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                aria-label={`Dígito ${index + 1}`}
              />
            ))}
          </div>

          {historyQuery.isFetching ? (
            <p className="mt-5 text-sm text-muted-foreground">Validando código...</p>
          ) : invalidCode ? (
            <p className="mt-5 text-sm font-medium text-destructive">Código inválido para este histórico.</p>
          ) : historyQuery.error ? (
            <p className="mt-5 text-sm font-medium text-destructive">Não foi possível validar o código.</p>
          ) : null}

          <p className="mt-10 text-sm text-muted-foreground">
            Não sabe o código? Solicite ao gestor da empresa.
          </p>

          <Button asChild variant="outline" className="mt-20">
            <Link to="/auth">Efetuar Login</Link>
          </Button>
        </div>
      </AccessShell>
    );
  }

  const lead = payload.lead;

  return (
    <div className="min-h-screen bg-[#F8F5EF] text-foreground">
      <header className="border-b bg-background/95 px-6 py-5">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-semibold tracking-tight">HUB Katsuki</div>
              <div className="text-xs text-muted-foreground">Histórico individual do lead</div>
            </div>
          </div>

          <Button asChild variant="outline" size="sm">
            <Link to="/auth">
              Fazer login
              <ArrowUpRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_520px]">
        <section className="space-y-6">
          <div>
            <div className="text-sm text-muted-foreground">Lead #{lead.id}</div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{lead.nome ?? "Lead sem nome"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Acompanhe os detalhes e o contexto do atendimento.
            </p>
          </div>

          <Card className="p-6">
            <h2 className="text-lg font-semibold">Detalhes do lead</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Detail icon={<Phone className="h-4 w-4" />} label="Telefone" value={lead.telefone ?? "—"} onCopy={lead.telefone ? () => copyPhone(lead.telefone) : undefined} />
              <Detail icon={<Mail className="h-4 w-4" />} label="Email" value={lead.email ?? "—"} />
              <Detail icon={<Building2 className="h-4 w-4" />} label="Empreendimento" value={lead.empreendimento_nome ?? "Sem interesse"} />
              <Detail icon={<UserRound className="h-4 w-4" />} label="Origem" value={formatLeadOrigin(lead.origem)} />
              <Detail label="Empresa" value={lead.empresa_nome ?? "—"} />
              <Detail label="Criado em" value={formatDateTime(lead.created_at)} />
            </div>
          </Card>
        </section>

        <aside className="overflow-hidden rounded-2xl border bg-background shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold">Histórico de conversa</h2>
            <p className="text-sm text-muted-foreground">Contexto do atendimento registrado para este lead.</p>
          </div>

          <div
            className="h-[calc(100vh-190px)] min-h-[560px] overflow-y-auto p-5"
            style={{
              backgroundColor: "#F7F2EA",
              backgroundImage:
                "linear-gradient(45deg, rgba(193,79,33,0.035) 25%, transparent 25%), linear-gradient(-45deg, rgba(193,79,33,0.035) 25%, transparent 25%)",
              backgroundSize: "28px 28px",
            }}
          >
            {!messages.length ? (
              <div className="mx-auto mt-10 max-w-sm rounded-lg bg-background/90 px-4 py-5 text-center text-sm text-muted-foreground shadow-sm">
                Nenhuma mensagem encontrada para este lead.
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => {
                  const isAi = message.type === "ai";
                  const text = messageToText(message.message);

                  return (
                    <div key={message.id} className={cn("flex", isAi ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[86%] rounded-2xl px-4 py-2 text-sm shadow-sm",
                          isAi
                            ? "rounded-br-md bg-primary text-primary-foreground"
                            : "rounded-bl-md bg-white text-foreground",
                        )}
                      >
                        <MessageContent text={text || "Mensagem sem conteúdo"} />
                        <div className={cn(
                          "mt-1 flex items-center justify-end gap-1 text-[10px]",
                          isAi ? "text-primary-foreground/80" : "text-muted-foreground",
                        )}>
                          {isAi ? <Bot className="h-3 w-3" /> : null}
                          {formatDateTime(message.time ?? message.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

function AccessShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-background px-6 py-12 text-center">
        <div className="mx-auto flex w-fit items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <div className="text-4xl font-semibold tracking-tight text-primary">HUB Katsuki</div>
        </div>
        <p className="mx-auto mt-6 max-w-xl text-sm text-muted-foreground">
          Queremos manter os dados dos seus clientes seguros. Por isso, sempre vamos pedir um código para acessar o histórico.
        </p>
      </div>

      <div className="px-6 py-12">{children}</div>
    </div>
  );
}

function Detail({
  icon,
  label,
  value,
  onCopy,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  onCopy?: () => void;
}) {
  return (
    <div className="rounded-lg border bg-background px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {icon}
            {label}
          </div>
          <div className="mt-1 break-words font-medium">{value}</div>
        </div>
        {onCopy ? (
          <button
            type="button"
            onClick={onCopy}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Copiar"
            aria-label="Copiar"
          >
            <Copy className="h-4 w-4" />
          </button>
        ) : null}
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
