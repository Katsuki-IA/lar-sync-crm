import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { useCrmUser } from "@/hooks/use-crm-user";
import { db, Notice, inputClass } from "@/hml/modules";
import { adminRpc, useAdminMutation } from "@/hml/administration";
import { Secretary } from "@/hml/secretary";

type Queue = {
  id: string;
  name: string;
  active: boolean;
  timeout_minutes: number;
  revision: number;
};
type Member = { id: string; nome: string; active: boolean; role: string };
type Membership = { queue_id: string; member_id: string; position: number };
type Distribution = {
  id: string;
  queue_id: string;
  opportunity_id: string;
  status: string;
  created_at: string;
};
type Offer = {
  id: string;
  distribution_id: string;
  member_id: string;
  opportunity_title: string;
  status: string;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
};
const labels: Record<string, string> = {
  pending: "Aguardando aceite",
  accepted: "Aceita",
  declined: "Recusada",
  expired: "Prazo encerrado",
  unavailable: "Corretor indisponível",
  cancelled: "Cancelada",
  exhausted: "Sem aceite · ação do gestor",
};
const date = (v: string) =>
  new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
export const Route = createFileRoute("/_authenticated/filas")({ component: Page });
function Page() {
  const { activeEmpresaId } = useActiveEmpresa();
  return activeEmpresaId ? <Workspace key={activeEmpresaId} companyId={activeEmpresaId} /> : null;
}
function Workspace({ companyId }: { companyId: number }) {
  const { data: me } = useCrmUser();
  const manager = me?.role === "manager" || me?.role === "super_admin";
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Queue | null | undefined>();
  const [enqueue, setEnqueue] = useState(false);
  const [processing, setProcessing] = useState(false);
  const busy = useRef(false);
  const query = useQuery({
    queryKey: ["sales-distribution", companyId, me?.id],
    enabled: !!me,
    refetchInterval: 15000,
    queryFn: async () => {
      const results = await Promise.all([
        db
          .from("hub_sales_offers")
          .select("*")
          .eq("id_empresa", companyId)
          .order("created_at", { ascending: false })
          .limit(200),
        ...(manager
          ? [
              db
                .from("hub_sales_queues")
                .select("id,name,active,timeout_minutes,revision")
                .eq("id_empresa", companyId)
                .order("name"),
              db
                .from("hub_sales_queue_members")
                .select("queue_id,member_id,position")
                .eq("id_empresa", companyId)
                .order("position"),
              db
                .from("hub_sales_distributions")
                .select("id,queue_id,opportunity_id,status,created_at")
                .eq("id_empresa", companyId)
                .order("created_at", { ascending: false })
                .limit(100),
              db
                .from("crm_users")
                .select("id,nome,active,role")
                .eq("id_empresa", companyId)
                .in("role", ["agent", "manager"]),
              db
                .from("crm_opportunities")
                .select("id,title,lead_id")
                .eq("id_empresa", companyId)
                .is("assigned_to", null),
              db.from("crm_leads").select("id,nome").eq("id_empresa", companyId),
            ]
          : []),
      ]);
      for (const r of results) if (r.error) throw r.error;
      return {
        offers: results[0].data as Offer[],
        queues: (results[1]?.data ?? []) as Queue[],
        memberships: (results[2]?.data ?? []) as Membership[],
        distributions: (results[3]?.data ?? []) as Distribution[],
        members: (results[4]?.data ?? []) as Member[],
        opportunities: (results[5]?.data ?? []) as { id: string; title: string; lead_id: number }[],
        contacts: (results[6]?.data ?? []) as { id: number; nome: string }[],
      };
    },
  });
  const answer = useAdminMutation<{ id: string; action: string }>(async ({ id, action }) => {
    const result = await adminRpc("hub_respond_sales_offer", { p_offer: id, p_action: action });
    if (result.status === "expired")
      toast.info("O prazo encerrou. A oferta seguiu para o próximo corretor.");
    else if (!["accepted", "declined"].includes(result.status))
      toast.info("Esta oferta já foi encerrada.");
    return result;
  }, "Resposta registrada");
  const cancel = useAdminMutation<string>(
    (id) => adminRpc("hub_process_sales_distribution", { p_id: id, p_cancel: true }),
    "Distribuição cancelada",
  );
  const process = async (ids: string[], silent = false) => {
    if (busy.current || !ids.length) return;
    busy.current = true;
    setProcessing(true);
    try {
      for (const id of ids)
        await adminRpc("hub_process_sales_distribution", { p_id: id, p_cancel: false });
      await qc.invalidateQueries();
      if (!silent) toast.success("Prazos e disponibilidade verificados");
    } catch {
      toast.error("Não foi possível avançar a distribuição. Tente novamente.");
    } finally {
      busy.current = false;
      setProcessing(false);
    }
  };
  if (query.isPending) return <p>Carregando distribuição…</p>;
  if (query.isError)
    return (
      <Notice title="Não foi possível carregar as filas">
        <Button onClick={() => query.refetch()}>Tentar novamente</Button>
      </Notice>
    );
  const data = query.data;
  const ownOffers = data.offers.filter((o) => o.member_id === me?.id);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {manager ? "Filas de distribuição" : "Minhas ofertas"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {manager
              ? "Distribua oportunidades sem responsável e acompanhe cada aceite."
              : "Aceite uma oferta para assumir a oportunidade no CRM."}
          </p>
        </div>
        {manager && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              <Plus />
              Nova fila
            </Button>
            <Button disabled={!data.queues.some((q) => q.active)} onClick={() => setEnqueue(true)}>
              Distribuir oportunidade
            </Button>
          </div>
        )}
      </header>
      {manager && (
        <>
          <div className="rounded-xl border bg-white p-4 text-sm">
            <p>
              Ofertas sequenciais, em rodízio, com prazo em minutos corridos. Cada corretor recebe
              no máximo uma oferta por rodada.
            </p>
            <p className="mt-2 text-muted-foreground">
              A tela atualiza a cada 15 segundos. Aceites fora do prazo são recusados imediatamente.
              O avanço automático da fila depende da ativação do processamento no servidor.
              Os avisos de WhatsApp dependem da configuração da secretária.
            </p>
          </div>
          <section className="grid gap-3 md:grid-cols-2">
            {data.queues.map((q) => (
              <article className="rounded-xl border bg-white p-4" key={q.id}>
                <div className="flex justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{q.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {q.active ? "Ativa" : "Pausada"} · {q.timeout_minutes} min para responder
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.distributions.some(
                      (d) => d.queue_id === q.id && d.status === "pending",
                    )}
                    onClick={() => setEditing(q)}
                  >
                    Editar fila
                  </Button>
                </div>
                <ol className="mt-3 space-y-1 text-sm">
                  {data.memberships
                    .filter((m) => m.queue_id === q.id)
                    .map((m, i) => (
                      <li key={m.member_id}>
                        {i + 1}. {data.members.find((u) => u.id === m.member_id)?.nome ?? "Membro"}
                        {!data.members.some(
                          (u) => u.id === m.member_id && u.active && u.role === "agent",
                        )
                          ? " · Indisponível"
                          : ""}
                      </li>
                    ))}
                </ol>
              </article>
            ))}
          </section>
          {!data.queues.length && (
            <Notice title="Crie sua primeira fila">
              Selecione os corretores, organize a ordem e defina o prazo de aceite.
            </Notice>
          )}
          <section className="space-y-3">
            <header className="flex flex-wrap justify-between gap-3">
              <h2 className="text-lg font-semibold">Distribuições recentes</h2>
              <Button
                variant="outline"
                size="sm"
                disabled={processing || !data.distributions.some((d) => d.status === "pending")}
                onClick={() =>
                  process(data.distributions.filter((d) => d.status === "pending").map((d) => d.id))
                }
              >
                <RefreshCw />
                Verificar prazos
              </Button>
            </header>
            {!data.distributions.length && (
              <p className="text-sm text-muted-foreground">
                Nenhuma oportunidade distribuída ainda.
              </p>
            )}
            {data.distributions.map((d) => {
              const offers = data.offers
                .filter((o) => o.distribution_id === d.id)
                .sort((a, b) => a.created_at.localeCompare(b.created_at));
              return (
                <article className="rounded-xl border bg-white p-4" key={d.id}>
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">
                        {offers[0]?.opportunity_title ??
                          data.opportunities.find((o) => o.id === d.opportunity_id)?.title ??
                          "Oportunidade"}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {data.queues.find((q) => q.id === d.queue_id)?.name} · {date(d.created_at)}
                      </p>
                      <p className="mt-2 text-sm">{labels[d.status]}</p>
                    </div>
                    {d.status === "pending" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(d.id)}
                      >
                        Cancelar distribuição
                      </Button>
                    )}
                  </div>
                  {d.status === "exhausted" && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Esta rodada terminou sem aceite. Se a oportunidade ainda estiver sem
                      responsável, revise a equipe antes de iniciar uma nova rodada.
                    </p>
                  )}
                  <details className="mt-3 border-t pt-3 text-sm">
                    <summary className="text-primary">Histórico de ofertas</summary>
                    <ol className="mt-3 space-y-2">
                      {offers.map((o) => (
                        <li key={o.id} className="rounded-lg bg-muted p-3">
                          <strong>
                            {data.members.find((m) => m.id === o.member_id)?.nome ?? "Corretor"}
                          </strong>{" "}
                          · {labels[o.status]}
                          <p className="text-xs text-muted-foreground">
                            Ofertada em {date(o.created_at)} · Prazo {date(o.expires_at)}
                            {o.resolved_at ? " · Encerrada em " + date(o.resolved_at) : ""}
                          </p>
                        </li>
                      ))}
                    </ol>
                    {!offers.length && (
                      <p className="mt-2">Nenhum corretor elegível no momento da distribuição.</p>
                    )}
                  </details>
                </article>
              );
            })}
            <p className="text-xs text-muted-foreground">
              Até 100 distribuições e 200 ofertas mais recentes nesta prévia.
            </p>
          </section>
        </>
      )}
      {!manager && (
        <section className="space-y-3">
          {ownOffers.map((o) => {
            const expired = new Date(o.expires_at).getTime() <= Date.now();
            return (
              <article key={o.id} className="rounded-xl border bg-white p-5">
                <h2 className="font-semibold">{o.opportunity_title}</h2>
                <p className="mt-2 text-sm">
                  {o.status === "pending" && expired ? "Prazo encerrado" : labels[o.status]}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Prazo: {date(o.expires_at)}</p>
                {o.status === "pending" && !expired && (
                  <div className="mt-4 flex gap-2">
                    <Button
                      disabled={answer.isPending}
                      onClick={() => answer.mutate({ id: o.id, action: "accept" })}
                    >
                      Aceitar oportunidade
                    </Button>
                    <Button
                      variant="outline"
                      disabled={answer.isPending}
                      onClick={() => answer.mutate({ id: o.id, action: "decline" })}
                    >
                      Recusar
                    </Button>
                  </div>
                )}
                {o.status === "accepted" && (
                  <Link to="/crm" className="mt-3 inline-block text-sm text-primary underline">
                    Abrir CRM comercial
                  </Link>
                )}
              </article>
            );
          })}
          {!ownOffers.length && (
            <Notice title="Nenhuma oferta para você">
              As novas ofertas aparecerão aqui. A lista atualiza a cada 15 segundos.
            </Notice>
          )}
        </section>
      )}
      {me && (
        <Secretary
          key={me.id}
          companyId={companyId}
          userId={me.id}
          manager={manager}
          members={data.members}
        />
      )}
      {editing !== undefined && (
        <QueueEditor
          companyId={companyId}
          queue={editing}
          members={data.members}
          selected={data.memberships
            .filter((m) => m.queue_id === editing?.id)
            .map((m) => m.member_id)}
          onClose={() => setEditing(undefined)}
        />
      )}
      {enqueue && (
        <Enqueue
          queues={data.queues.filter((q) => q.active)}
          opportunities={data.opportunities
            .filter(
              (o) =>
                !data.distributions.some(
                  (d) => d.opportunity_id === o.id && d.status === "pending",
                ),
            )
            .map((o) => ({
              ...o,
              label:
                (data.contacts.find((c) => c.id === o.lead_id)?.nome ?? "Lead") +
                " · " +
                o.title,
            }))}
          onClose={() => setEnqueue(false)}
        />
      )}
    </div>
  );
}
function QueueEditor({
  companyId,
  queue,
  members,
  selected,
  onClose,
}: {
  companyId: number;
  queue: Queue | null;
  members: Member[];
  selected: string[];
  onClose: () => void;
}) {
  const [name, setName] = useState(queue?.name ?? "");
  const [timeout, setTimeout] = useState(queue?.timeout_minutes ?? 10);
  const [active, setActive] = useState(queue?.active ?? true);
  const [ids, setIds] = useState(selected);
  const [request] = useState(() => crypto.randomUUID());
  const save = useAdminMutation<void>(
    () =>
      adminRpc("hub_save_sales_queue", {
        p_company_id: companyId,
        p_id: queue?.id ?? null,
        p_name: name,
        p_timeout: timeout,
        p_members: ids,
        p_active: active,
        p_revision: queue?.revision ?? null,
        p_request_id: request,
      }),
    "Fila salva",
    onClose,
  );
  const shift = (index: number, delta: number) => {
    const copy = [...ids];
    [copy[index], copy[index + delta]] = [copy[index + delta], copy[index]];
    setIds(copy);
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{queue ? "Editar fila" : "Nova fila"}</DialogTitle>
          <DialogDescription>
            O rodízio continua após o último corretor ofertado. Para editar, encerre as
            distribuições abertas.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <fieldset disabled={save.isPending} className="space-y-4">
            <label className="block text-sm">
              Nome
              <Input
                aria-label="Nome da fila"
                required
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Prazo de aceite (minutos corridos)
              <Input
                aria-label="Prazo de aceite"
                type="number"
                min={1}
                max={1440}
                required
                value={timeout}
                onChange={(e) => setTimeout(Number(e.target.value))}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Fila ativa
            </label>
            <div>
              <p className="mb-2 text-sm font-medium">Corretores participantes</p>
              {members
                .filter((m) => m.role === "agent" || ids.includes(m.id))
                .map((m) => (
                  <label key={m.id} className="mb-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ids.includes(m.id)}
                      disabled={(!m.active || m.role !== "agent") && !ids.includes(m.id)}
                      onChange={(e) =>
                        setIds(e.target.checked ? [...ids, m.id] : ids.filter((id) => id !== m.id))
                      }
                    />
                    {m.nome}
                    {!m.active || m.role !== "agent" ? " · Indisponível" : ""}
                  </label>
                ))}
            </div>
            <ol className="space-y-2">
              {ids.map((id, i) => (
                <li
                  key={id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-muted p-2 text-sm"
                >
                  <span>
                    {i + 1}. {members.find((m) => m.id === id)?.nome ?? "Membro"}
                  </span>
                  <span className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={"Subir " + (i + 1)}
                      disabled={i === 0}
                      onClick={() => shift(i, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={"Descer " + (i + 1)}
                      disabled={i === ids.length - 1}
                      onClick={() => shift(i, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Cancelar
            </Button>
            <Button
              disabled={
                save.isPending ||
                !ids.length ||
                ids.some(
                  (id) => !members.some((m) => m.id === id && m.active && m.role === "agent"),
                )
              }
            >
              {save.isPending ? "Salvando…" : "Salvar fila"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function Enqueue({
  queues,
  opportunities,
  onClose,
}: {
  queues: Queue[];
  opportunities: { id: string; label: string }[];
  onClose: () => void;
}) {
  const [queue, setQueue] = useState(queues[0]?.id ?? "");
  const [op, setOp] = useState("");
  const [request] = useState(() => crypto.randomUUID());
  const save = useAdminMutation<void>(
    () =>
      adminRpc("hub_enqueue_sales", { p_queue: queue, p_opportunity: op, p_request_id: request }),
    "Distribuição registrada",
    onClose,
  );
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !save.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Distribuir oportunidade</DialogTitle>
          <DialogDescription>
            Escolha uma oportunidade sem responsável. A atribuição ocorre somente após o aceite.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <label className="block text-sm">
            Fila
            <select
              className={inputClass}
              aria-label="Fila de destino"
              value={queue}
              disabled={save.isPending}
              onChange={(e) => setQueue(e.target.value)}
            >
              {queues.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Oportunidade
            <select
              className={inputClass}
              aria-label="Oportunidade para distribuir"
              required
              value={op}
              disabled={save.isPending}
              onChange={(e) => setOp(e.target.value)}
            >
              <option value="">Selecione uma oportunidade</option>
              {opportunities.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {!opportunities.length && (
            <p className="text-sm text-muted-foreground">
              Nenhuma oportunidade disponível. Cadastre uma no CRM deixando o responsável em branco.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              Cancelar
            </Button>
            <Button disabled={!op || !queue || save.isPending}>
              {save.isPending ? "Distribuindo…" : "Iniciar distribuição"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

