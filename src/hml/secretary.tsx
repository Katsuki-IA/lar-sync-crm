import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { db, Notice } from "@/hml/modules";
import { SecretarySettings } from "@/hml/secretary-settings";
import { useCrmUser } from "@/hooks/use-crm-user";

type Result = { status: string; message: string };
type NoticeRow = {
  id: string;
  offer_id: string;
  member_id: string;
  body: string;
  code: string;
  created_at: string;
};
type ResponseRow = {
  id: string;
  member_id: string;
  body: string;
  result: Result;
  created_at: string;
  channel: string;
};
const date = (v: string) =>
  new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function Secretary({
  companyId,
  userId,
  manager,
  members,
}: {
  companyId: number;
  userId: string;
  manager: boolean;
  members: { id: string; nome: string }[];
}) {
  const { data: me } = useCrmUser();
  const query = useQuery({
    queryKey: ["secretary", companyId, userId],
    refetchInterval: 15000,
    queryFn: async () => {
      const [notices, responses, outbox, channels] = await Promise.all([
        db
          .from("hub_secretary_notices")
          .select("id,offer_id,member_id,body,code,created_at")
          .eq("id_empresa", companyId)
          .order("created_at", { ascending: false })
          .limit(50),
        db
          .from("hub_secretary_responses")
          .select("id,member_id,body,result,created_at,channel")
          .eq("id_empresa", companyId)
          .order("created_at", { ascending: false })
          .limit(50),
        db
          .from("hub_whatsapp_outbox")
          .select("id,notice_id,member_id,status,attempts,reason,created_at")
          .eq("id_empresa", companyId)
          .order("created_at", { ascending: false })
          .limit(20),
        db
          .from("hub_whatsapp_channels")
          .select("instance,enabled,provider,auto_send")
          .eq("id_empresa", companyId),
      ]);
      if (notices.error) throw notices.error;
      if (responses.error) throw responses.error;
      if (outbox.error) throw outbox.error;
      if (channels.error) throw channels.error;
      return {
        notices: notices.data as NoticeRow[],
        responses: responses.data as ResponseRow[],
        outbox: outbox.data,
        channel: channels.data[0],
      };
    },
  });
  const name = (id: string) => members.find((m) => m.id === id)?.nome ?? "Você";
  return (
    <section className="space-y-4 rounded-xl border bg-white p-5" aria-labelledby="secretary-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="secretary-title" className="flex items-center gap-2 text-lg font-semibold">
            <MessageSquare className="size-5 text-primary" />
            Secretária
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Avisos automáticos para cada nova oferta e histórico de respostas.
          </p>
        </div>
      </header>
      {manager && <SecretarySettings key={companyId} companyId={companyId} isAdmin={me?.role === "super_admin"} />}
      {query.isPending ? (
        <p className="text-sm">Carregando avisos…</p>
      ) : query.isError ? (
        <Notice title="Não foi possível carregar a secretária">
          <Button variant="outline" onClick={() => query.refetch()}>
            Tentar novamente
          </Button>
        </Notice>
      ) : (
        <>
          {manager && (
            <div className="rounded-lg border p-4 text-sm">
              <h3 className="font-semibold">Histórico de envios</h3>
              <p className="mt-1 text-muted-foreground">
                {query.data.channel
                  ? `${query.data.channel.instance} · ${query.data.channel.enabled ? "Habilitado" : "Pausado"}`
                  : "Canal ainda não configurado"}
                . O retorno real das mensagens depende da configuração do webhook.
              </p>
              {query.data.outbox.map((job) => (
                <p key={job.id} className="mt-2 text-xs">
                  {name(job.member_id)} · {date(job.created_at)} ·{" "}
                  {
                    (
                      {
                        pending: "Na fila",
                        sending: "Processando envio",
                        sent: "Enviado ao provedor",
                        uncertain: "Resultado incerto · conferir antes de reenviar",
                        failed: "Falha no envio",
                        cancelled: "Envio cancelado",
                      } as Record<string, string>
                    )[job.status]
                  }{" "}
                  · {job.attempts} tentativa(s)
                </p>
              ))}
              <p className="mt-2 text-xs text-muted-foreground">
                Enviado ao provedor não confirma entrega ou leitura no WhatsApp.
              </p>
            </div>
          )}
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 text-sm font-semibold">Avisos gerados</h3>
              {!query.data.notices.length && (
                <p className="text-sm text-muted-foreground">
                  Ao distribuir uma nova oportunidade, o aviso aparecerá aqui automaticamente.
                </p>
              )}
              <div className="max-h-96 space-y-3 overflow-y-auto">
                {query.data.notices.map((n) => (
                  <article key={n.id} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">
                      {manager ? name(n.member_id) + " · " : ""}
                      {date(n.created_at)} · Prévia do aviso
                    </p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm">{n.body}</p>
                  </article>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold">Histórico de respostas</h3>
              {!query.data.responses.length && (
                <p className="text-sm text-muted-foreground">Nenhuma resposta registrada.</p>
              )}
              <div className="max-h-96 space-y-3 overflow-y-auto">
                {query.data.responses.map((r) => (
                  <article key={r.id} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">
                      {manager ? name(r.member_id) + " · " : ""}
                      {date(r.created_at)} ·{" "}
                      {`WhatsApp · ${r.channel}`}
                    </p>
                    <p className="mt-2 break-words text-sm font-medium">{r.body}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{r.result.message}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Últimos 50 avisos e 50 respostas. O histórico registra o resultado no momento da
            resposta; o estado atual aparece nas ofertas.
          </p>
        </>
      )}
    </section>
  );
}

