import { Input } from "@/components/ui/input";
import { inputClass } from "@/hml/modules";
import { weekdays } from "@/lib/sales-queue";
import type { QueueRules } from "@/lib/sales-queue";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, Settings2, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfigSection, ConfigStatus } from "@/components/config-presentation";
import { isQueueAgent, nextQueueMember, offerRemaining, queueSchedule } from "@/lib/sales-queue";
import type {
  SalesQueue,
  QueueMember,
  QueueMembership,
  SalesDistribution,
  SalesOffer,
  QueueOverview,
} from "@/lib/sales-queue";

export function SalesQueueWorkspace({
  queues,
  members,
  memberships,
  distributions,
  offers,
  overview,
  developments,
  stages,
  onEdit,
  onEnqueue,
  onPause,
  onCancel,
  busy,
}: {
  queues: SalesQueue[];
  members: QueueMember[];
  memberships: QueueMembership[];
  distributions: SalesDistribution[];
  offers: SalesOffer[];
  overview: QueueOverview | null;
  developments: { id: number; nome: string }[];
  stages: { id: number; nome: string }[];
  onEdit: (q: SalesQueue | null) => void;
  onEnqueue: () => void;
  onPause: (queue: string, member: string, paused: boolean) => void;
  onCancel: (id: string) => void;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<string>();
  const queue = queues.find((q) => q.id === selected) ?? queues[0];
  const queueDistributions = distributions.filter((d) => d.queue_id === queue?.id);
  const queueOffers = offers.filter((o) =>
    queueDistributions.some((d) => d.id === o.distribution_id),
  );
  const pending = overview
    ? overview.pending.filter((o) => o.queue_id === queue?.id)
    : queueOffers.filter((o) => o.status === "pending");
  const participants = memberships
    .filter((m) => m.queue_id === queue?.id)
    .sort((a, b) => a.position - b.position);
  const next = queue ? nextQueueMember(queue, members, memberships) : undefined;
  const hasPending = pending.length > 0 || queueDistributions.some((d) => d.status === "pending");
  return (
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-3" aria-label="Filas da empresa">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Filas
          </h2>
          <Button size="sm" onClick={() => onEdit(null)}>
            <Plus className="size-4" />
            Nova fila
          </Button>
        </div>
        <nav className="space-y-1 rounded-xl border bg-card p-2" aria-label="Escolher fila">
          {queues.map((q) => (
            <button
              key={q.id}
              onClick={() => setSelected(q.id)}
              aria-current={queue?.id === q.id ? "true" : undefined}
              className={`w-full rounded-lg px-3 py-3 text-left text-sm transition-colors ${queue?.id === q.id ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
            >
              <span className="block font-medium">{q.name}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {q.development_id
                  ? (developments.find((d) => d.id === q.development_id)?.nome ??
                    "Empreendimento específico")
                  : "Todos os empreendimentos"}{" "}
                · {q.active ? "Ativa" : "Pausada"}
              </span>
            </button>
          ))}
          {!queues.length && (
            <p className="p-3 text-sm text-muted-foreground">Nenhuma fila cadastrada.</p>
          )}
        </nav>
        <p className="px-1 text-xs leading-relaxed text-muted-foreground">
          Distribuição por ordem: cada corretor recebe na sua vez. A atribuição ocorre após o
          aceite.
        </p>
        <Link
          to="/configuracoes/secretaria"
          className="inline-flex items-center gap-2 px-1 text-sm text-primary"
        >
          <Settings2 className="size-4" />
          Configurar secretária
        </Link>
      </aside>
      <div className="min-w-0 space-y-5">
        {queue ? (
          <>
            <ConfigSection>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{queue.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {queue.development_id
                      ? (developments.find((d) => d.id === queue.development_id)?.nome ??
                        "Empreendimento específico")
                      : "Todos os empreendimentos da empresa"}
                  </p>
                </div>
                <ConfigStatus>{queue.active ? "Fila ativa" : "Fila pausada"}</ConfigStatus>
              </div>
              <dl className="grid gap-5 text-sm sm:grid-cols-2 xl:grid-cols-3">
                <div>
                  <dt className="mb-1 font-medium">Gatilhos de entrada</dt>
                  <dd className="text-muted-foreground">
                    {queue.trigger_qualified ? "Qualificado pela IA" : ""}
                    {queue.trigger_qualified && !!queue.trigger_stage_ids?.length ? " ou " : ""}
                    {queue.trigger_stage_ids
                      ?.map((id) => stages.find((s) => s.id === id)?.nome ?? `Etapa ${id}`)
                      .join(", ")}
                    {!queue.trigger_qualified && !queue.trigger_stage_ids?.length
                      ? "Distribuição manual"
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt className="mb-1 font-medium">Tempo para aceitar</dt>
                  <dd className="text-muted-foreground">
                    {queue.timeout_minutes} minutos corridos
                  </dd>
                </div>
                <div>
                  <dt className="mb-1 font-medium">Horário de distribuição</dt>
                  <dd className="text-muted-foreground">
                    {queueSchedule(queue)}
                    <span className="block text-xs">Horário de Brasília</span>
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                <Button variant="outline" disabled={hasPending} onClick={() => onEdit(queue)}>
                  Editar fila e corretores
                </Button>
                <Button variant="outline" disabled={!queue.active} onClick={onEnqueue}>
                  Distribuir oportunidade
                </Button>
                {hasPending && (
                  <p className="text-xs text-muted-foreground">
                    Encerre as distribuições abertas para editar a estrutura. A pausa individual
                    continua disponível.
                  </p>
                )}
              </div>
              {!overview?.installed && (
                <p className="text-sm text-muted-foreground">
                  Gatilhos, horários e pausa por fila aguardam a atualização do servidor. As regras
                  atuais continuam valendo.
                </p>
              )}
            </ConfigSection>
            <ConfigSection>
              <div>
                <h2 className="font-semibold">Corretores na fila</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tempo médio entre a oferta e o aceite. Recebidos conta ofertas criadas, não
                  confirma entrega no WhatsApp.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b text-xs uppercase text-muted-foreground">
                    <tr>
                      {[
                        "#",
                        "Corretor",
                        "Situação",
                        "Recebidos",
                        "Aceitos",
                        "Tempo médio de aceite",
                        "Na fila",
                      ].map((t) => (
                        <th key={t} className="px-2 py-3 font-medium">
                          {t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {participants.map((p, i) => {
                      const member = members.find((m) => m.id === p.member_id);
                      const eligible = member?.active && isQueueAgent(member);
                      const stats = overview?.stats.find(
                        (s) => s.queue_id === queue.id && s.member_id === p.member_id,
                      );
                      return (
                        <tr key={p.member_id} className="border-b last:border-0">
                          <td className="px-2 py-4 text-muted-foreground">{i + 1}</td>
                          <td className="px-2 py-4 font-medium">{member?.nome ?? "Corretor"}</td>
                          <td className="px-2 py-4">
                            <span
                              className={
                                p.member_id === next && !p.paused
                                  ? "text-primary"
                                  : "text-muted-foreground"
                              }
                            >
                              {!eligible
                                ? "Usuário indisponível"
                                : p.paused
                                  ? "Pausado"
                                  : p.member_id === next
                                    ? "Próximo da ordem"
                                    : "Participando"}
                            </span>
                          </td>
                          <td className="px-2 py-4">{overview ? (stats?.received ?? 0) : "—"}</td>
                          <td className="px-2 py-4">{overview ? (stats?.accepted ?? 0) : "—"}</td>
                          <td className="px-2 py-4">
                            {stats?.mean_minutes != null
                              ? `${Math.round(stats.mean_minutes * 10) / 10} min`
                              : "—"}
                          </td>
                          <td className="px-2 py-4">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy || !overview?.installed || !eligible}
                              aria-label={`${p.paused ? "Retomar" : "Pausar"} ${member?.nome ?? "corretor"} nesta fila`}
                              onClick={() => onPause(queue.id, p.member_id, !p.paused)}
                            >
                              {p.paused ? "Retomar" : "Pausar"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Pausar nesta fila preserva a posição e o acesso do usuário. Ofertas já enviadas
                mantêm o prazo de aceite.
              </p>
            </ConfigSection>
            <ConfigSection>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Aguardando aceite</h2>
                <ConfigStatus>
                  {pending.length} {overview ? "ofertas" : "ofertas carregadas"}
                </ConfigStatus>
              </div>
              {!pending.length ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma oferta aguardando aceite nesta fila.
                </p>
              ) : (
                <ul className="divide-y">
                  {pending.map((o) => (
                    <li
                      key={o.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-4"
                    >
                      <div>
                        <p className="text-sm font-medium">{o.opportunity_title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Oferecida a{" "}
                          {members.find((m) => m.id === o.member_id)?.nome ?? "Corretor"}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1 text-xs text-primary">
                          <Clock3 className="size-3" />
                          {offerRemaining(o.expires_at)}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => onCancel(o.distribution_id)}
                        >
                          Cancelar distribuição
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ConfigSection>
            <details className="rounded-xl border bg-card p-5">
              <summary className="cursor-pointer text-sm font-medium">
                Histórico recente desta fila
              </summary>
              <ul className="mt-4 divide-y">
                {queueOffers
                  .filter((o) => o.status !== "pending")
                  .map((o) => (
                    <li key={o.id} className="py-3 text-sm">
                      <span className="font-medium">{o.opportunity_title}</span>
                      <p className="text-xs text-muted-foreground">
                        {members.find((m) => m.id === o.member_id)?.nome ?? "Corretor"} ·{" "}
                        {(
                          {
                            accepted: "Aceita",
                            declined: "Recusada",
                            expired: "Prazo encerrado",
                            unavailable: "Indisponível",
                            cancelled: "Cancelada",
                          } as Record<string, string>
                        )[o.status] ?? o.status}{" "}
                        · {new Date(o.created_at).toLocaleString("pt-BR")}
                      </p>
                    </li>
                  ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Histórico limitado às últimas 200 ofertas e 100 distribuições. Os indicadores dos
                corretores usam todo o histórico.
              </p>
            </details>
          </>
        ) : (
          <ConfigSection>
            <h2 className="font-semibold">Crie sua primeira fila</h2>
            <p className="text-sm text-muted-foreground">
              Escolha os corretores, a ordem e o prazo de aceite.
            </p>
            <Button onClick={() => onEdit(null)}>
              <Plus />
              Nova fila
            </Button>
          </ConfigSection>
        )}
        <ConfigSection>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Aguardando distribuição</h2>
            <ConfigStatus>Empresa</ConfigStatus>
          </div>
          <p className="text-sm text-muted-foreground">
            Leads e oportunidades desta empresa que aguardam distribuição aos corretores.
          </p>
          <h3 className="text-sm font-semibold">
            Oportunidades comerciais aguardando distribuição
            {overview ? ` (${overview.waiting.length})` : ""}
          </h3>
          {!overview ? (
            <p className="text-sm text-muted-foreground">
              A espera automática ficará disponível após a atualização do servidor.
            </p>
          ) : !overview.waiting.length ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma oportunidade na espera automática.
            </p>
          ) : (
            <ul className="divide-y">
              {overview.waiting.map((w) => (
                <li key={w.opportunity_id} className="py-3">
                  <p className="text-sm font-medium">
                    {w.lead_name} · {w.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {w.reason === "processing_error"
                      ? "N�o foi poss�vel distribuir. O servidor tentar� novamente em alguns minutos."
                      : w.reason === "no_acceptance"
                        ? "Rodada sem aceite. Nova tentativa após 30 minutos."
                        : "Aguardando uma fila com regras, horário e corretores disponíveis."}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold">
              Leads aguardando uma fila compatível
              {overview?.lead_waiting ? ` (${overview.lead_waiting.length})` : ""}
            </h3>
            <p className="text-sm text-muted-foreground">
              São contatos recebidos pela empresa, não usuários ou corretores.
            </p>
            {!overview?.lead_waiting ? (
              <p className="text-sm text-muted-foreground">
                A lista de leads ficará disponível após a atualização do servidor.
              </p>
            ) : !overview.lead_waiting.length ? (
              <p className="text-sm text-muted-foreground">
                Nenhum lead aguardando uma fila compatível.
              </p>
            ) : (
              <ul className="divide-y">
                {overview.lead_waiting.map((lead) => (
                  <li
                    key={lead.lead_id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {lead.nome}{" "}
                        <span className="text-muted-foreground">· Lead #{lead.lead_id}</span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {lead.reason === "no_active_stage"
                          ? "O funil de destino precisa de uma etapa ativa."
                          : lead.reason === "processing_error"
                            ? "Entrada pendente. Nova tentativa em alguns minutos."
                            : "Aguardando uma fila com gatilho e empreendimento compatíveis."}
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link
                        to="/leads/$id"
                        params={{ id: String(lead.lead_id) }}
                        aria-label={`Abrir lead ${lead.nome}, número ${lead.lead_id}`}
                      >
                        Abrir lead
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Até 100 oportunidades e 100 leads mais antigos. Filas específicas do empreendimento têm
            preferência; depois, vale a menor prioridade numérica.
          </p>
        </ConfigSection>
      </div>
    </div>
  );
}

export function QueueRuleFields({
  rules: r,
  onChange,
  developments,
  stages,
  funnels = [],
}: {
  rules: QueueRules;
  onChange: (r: QueueRules) => void;
  developments: { id: number; nome: string }[];
  stages: { id: number; nome: string }[];
  funnels?: { id: number; nome: string }[];
}) {
  const set = (v: Partial<QueueRules>) => onChange({ ...r, ...v });
  return (
    <div className="space-y-5 border-y py-5">
      <label className="block text-sm font-medium">
        Funil comercial de destino
        <select
          className={inputClass}
          value={r.destination_funnel_id ?? ""}
          onChange={(e) =>
            set({ destination_funnel_id: e.target.value ? Number(e.target.value) : null })
          }
        >
          <option value="">Selecione para habilitar os gatilhos automáticos</option>
          {funnels.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          A oportunidade entra na primeira etapa ativa deste funil, sem responsável, antes da
          distribuição.
        </span>
      </label>
      <label className="block text-sm font-medium">
        Empreendimento
        <select
          className={inputClass}
          value={r.development_id ?? ""}
          onChange={(e) => set({ development_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Todos os empreendimentos</option>
          {developments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nome}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Gatilhos de entrada automática</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={r.trigger_qualified}
            onChange={(e) => set({ trigger_qualified: e.target.checked })}
          />
          Lead qualificado pela IA
        </label>
        <p className="text-sm font-medium">Lead na etapa IA</p>
        <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
          {stages.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={r.trigger_stage_ids.includes(s.id)}
                onChange={(e) =>
                  set({
                    trigger_stage_ids: e.target.checked
                      ? [...r.trigger_stage_ids, s.id]
                      : r.trigger_stage_ids.filter((id) => id !== s.id),
                  })
                }
              />
              {s.nome}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Basta atender a um dos gatilhos e pertencer ao empreendimento escolhido. Sem gatilhos
          marcados, a entrada é somente manual. Com um gatilho, o lead gera uma oportunidade no
          funil de destino. Oportunidades existentes e responsáveis já definidos são preservados.
        </p>
      </fieldset>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={r.schedule_enabled}
          onChange={(e) => set({ schedule_enabled: e.target.checked })}
        />
        Limitar dias e horários de distribuição
      </label>
      {r.schedule_enabled && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            {weekdays.map((d) => (
              <label key={d.id} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={r.weekdays.includes(d.id)}
                  onChange={(e) =>
                    set({
                      weekdays: e.target.checked
                        ? [...r.weekdays, d.id]
                        : r.weekdays.filter((id) => id !== d.id),
                    })
                  }
                />
                {d.label}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Início
              <Input
                type="time"
                required
                value={r.starts_at.slice(0, 5)}
                onChange={(e) => set({ starts_at: e.target.value })}
              />
            </label>
            <label className="text-sm">
              Fim
              <Input
                type="time"
                required
                min={r.starts_at}
                value={r.ends_at.slice(0, 5)}
                onChange={(e) => set({ ends_at: e.target.value })}
              />
            </label>
          </div>
          {(!r.weekdays.length || r.starts_at >= r.ends_at) && (
            <p role="alert" className="text-sm text-destructive">
              Selecione ao menos um dia e um término após o início.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Horário de Brasília. Fora desse intervalo, novas ofertas aguardam. Ofertas já enviadas
            mantêm o prazo.
          </p>
        </div>
      )}
      <label className="block text-sm font-medium">
        Prioridade entre filas
        <Input
          type="number"
          min={1}
          max={1000}
          required
          value={r.priority}
          onChange={(e) => set({ priority: Number(e.target.value) })}
        />
        <span className="text-xs font-normal text-muted-foreground">
          Menor número primeiro. Filas do empreendimento têm preferência sobre filas gerais
          disponíveis.
        </span>
      </label>
    </div>
  );
}
