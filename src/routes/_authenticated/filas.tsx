import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ArrowDown } from "lucide-react";
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

import { SalesQueueWorkspace, QueueRuleFields } from "@/hml/sales-queue-workspace";
import { defaultQueueRules, isQueueAgent } from "@/lib/sales-queue";
import type {
  SalesQueue as Queue,
  QueueMember as Member,
  QueueMembership as Membership,
  SalesDistribution as Distribution,
  SalesOffer as Offer,
  QueueOverview,
  QueueRules,
} from "@/lib/sales-queue";

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
  const [editing, setEditing] = useState<Queue | null | undefined>();
  const [enqueue, setEnqueue] = useState(false);
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
              db.from("hub_sales_queues").select("*").eq("id_empresa", companyId).order("name"),
              db
                .from("hub_sales_queue_members")
                .select("*")
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
                .in("role", ["agent", "corretor", "manager", "gestor"]),
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
      let overview: QueueOverview | null = null;
      let developments: { id: number; nome: string }[] = [];
      let stages: { id: number; nome: string }[] = [];
      let funnels: { id: number; nome: string }[] = [];
      if (manager) {
        const [summary, dev, stage, funnel] = await Promise.all([
          db.rpc("hub_sales_queue_overview", { p_company_id: companyId }),
          db.from("empreendimento").select("id,nome").eq("id_empresa", companyId).order("nome"),
          db
            .from("crm_stages")
            .select("id,nome")
            .eq("id_empresa", companyId)
            .eq("module", "ia")
            .eq("ativo", true)
            .order("ordem"),
          db.from("crm_funnels").select("id,nome").eq("id_empresa", companyId).eq("module", "crm").eq("ativo", true).order("nome"),
        ]);
        if (summary.error && !["PGRST202", "42883"].includes(summary.error.code))
          throw summary.error;
        if (dev.error) throw dev.error;
        if (stage.error) throw stage.error;
        if (funnel.error) throw funnel.error;
        funnels = funnel.data ?? [];
        overview = summary.error ? null : (summary.data as QueueOverview);
        developments = dev.data ?? [];
        stages = stage.data ?? [];
      }
      return {
        overview,
        developments,
        stages,
        funnels,
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
  const pause = useAdminMutation<{ queue: string; member: string; paused: boolean }>(
    ({ queue, member, paused }) =>
      adminRpc("hub_pause_queue_member", { p_queue: queue, p_member: member, p_paused: paused }),
    "Participação atualizada",
  );
  const cancel = useAdminMutation<string>(
    (id) => adminRpc("hub_process_sales_distribution", { p_id: id, p_cancel: true }),
    "Distribuição cancelada",
  );
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
          <h1 className="text-2xl font-semibold">
            {manager ? "Filas de distribuição" : "Minhas ofertas"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {manager
              ? "Distribua oportunidades sem responsável e acompanhe cada aceite."
              : "Aceite uma oferta para assumir a oportunidade no CRM."}
          </p>
        </div>
      </header>
      {manager && (
        <SalesQueueWorkspace
          {...data}
          onEdit={setEditing}
          onEnqueue={() => setEnqueue(true)}
          onPause={(queue, member, paused) => pause.mutate({ queue, member, paused })}
          onCancel={(id) => cancel.mutate(id)}
          busy={pause.isPending || cancel.isPending}
        />
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
      {editing !== undefined && (
        <QueueEditor
          companyId={companyId}
          queue={editing}
          installed={!!data.overview?.installed}
          funnels={data.funnels}
          developments={data.developments}
          stages={data.stages}
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
                (data.contacts.find((c) => c.id === o.lead_id)?.nome ?? "Lead") + " · " + o.title,
            }))}
          onClose={() => setEnqueue(false)}
        />
      )}
    </div>
  );
}
function QueueEditor({
  funnels,
  companyId,
  queue,
  installed,
  developments,
  stages,
  members,
  selected,
  onClose,
}: {
  funnels: { id: number; nome: string }[];
  companyId: number;
  queue: Queue | null;
  installed: boolean;
  developments: { id: number; nome: string }[];
  stages: { id: number; nome: string }[];
  members: Member[];
  selected: string[];
  onClose: () => void;
}) {
  const [rules, setRules] = useState<QueueRules>({ ...defaultQueueRules, ...queue });
  const [name, setName] = useState(queue?.name ?? "");
  const [timeout, setTimeout] = useState(queue?.timeout_minutes ?? 10);
  const [active, setActive] = useState(queue?.active ?? true);
  const [ids, setIds] = useState(selected);
  const [request] = useState(() => crypto.randomUUID());
  const save = useAdminMutation<void>(
    () =>
      adminRpc(installed ? "hub_save_sales_queue_v2" : "hub_save_sales_queue", {
        ...(installed ? { p_rules: rules } : {}),
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
      <DialogContent className="config-dialog max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{queue ? "Editar fila" : "Nova fila"}</DialogTitle>
          <DialogDescription>
            O rodízio continua após o último corretor ofertado. Para editar, encerre as
            distribuições abertas.
          </DialogDescription>
        </DialogHeader>
        <form
          className="config-form space-y-4"
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
            {installed && (
              <QueueRuleFields
                funnels={funnels}
                rules={rules}
                onChange={setRules}
                developments={developments}
                stages={stages}
              />
            )}
            {!installed && (
              <p className="text-sm text-muted-foreground">
                Gatilhos e horários aguardam a atualização do servidor.
              </p>
            )}
            <div>
              <p className="mb-2 text-sm font-medium">Corretores participantes</p>
              {members
                .filter((m) => isQueueAgent(m) || ids.includes(m.id))
                .map((m) => (
                  <label key={m.id} className="mb-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ids.includes(m.id)}
                      disabled={(!m.active || !isQueueAgent(m)) && !ids.includes(m.id)}
                      onChange={(e) =>
                        setIds(e.target.checked ? [...ids, m.id] : ids.filter((id) => id !== m.id))
                      }
                    />
                    {m.nome}
                    {!m.active || !isQueueAgent(m) ? " · Indisponível" : ""}
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
                (installed &&
                  rules.schedule_enabled &&
                  (!rules.weekdays.length || rules.starts_at >= rules.ends_at)) ||
                ids.some((id) => !members.some((m) => m.id === id && m.active && isQueueAgent(m)))
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
          className="config-form space-y-4"
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
