import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { OpportunityTags } from "@/hml/commercial-tags";
import { TaskWorkspace } from "@/hml/tasks";
import {
  db,
  inputClass,
  secondaryClass,
  type Stage,
  type Opportunity,
  type Member,
  useCompanyModules,
} from "@/hml/modules";
import { useCrmUser } from "@/hooks/use-crm-user";
import { LeadActivities } from "./lead-activities";
import { LeadConversation } from "./lead-conversation";

export function OpportunityDetail({ companyId, id }: { companyId: number; id: string }) {
  const { data: me } = useCrmUser();
  const modules = useCompanyModules(companyId);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["opportunity-detail", companyId, id, me?.id],
    enabled: !!me && !!modules.data?.crm,
    queryFn: async () => {
      const lookup = await db
        .from("crm_opportunities")
        .select("*")
        .eq("id_empresa", companyId)
        .eq("id", id)
        .single();
      if (lookup.error) throw lookup.error;
      const op = lookup.data as Opportunity;
      const [contact, stages, members] = await Promise.all([
        db
          .from("crm_leads")
          .select("id,nome,telefone")
          .eq("id_empresa", companyId)
          .eq("id", op.lead_id)
          .maybeSingle(),
        db
          .from("crm_stages")
          .select("id,id_funnel,nome,cor,ordem")
          .eq("id_empresa", companyId)
          .eq("id_funnel", op.funnel_id)
          .eq("module", "crm")
          .eq("ativo", true)
          .order("ordem"),
        db
          .from("crm_users")
          .select("id,nome,role,active")
          .eq("id_empresa", companyId)
          .in("role", ["manager", "agent"])
          .order("nome"),
      ]);
      for (const r of [contact, stages, members]) if (r.error) throw r.error;
      return {
        op,
        contact: contact.data,
        stages: stages.data as Stage[],
        members: members.data as Member[],
      };
    },
  });
  const move = useMutation({
    mutationFn: async (stageId: number) => {
      const op = query.data!.op;
      const { error } = await db.rpc("hub_move_opportunity", {
        p_id: op.id,
        p_stage_id: stageId,
        p_expected_version: op.version,
      });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Etapa comercial atualizada"),
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => qc.invalidateQueries(),
  });
  const back = (
    <Link className={secondaryClass} to="/crm" search={{}}>
      ← Voltar ao CRM comercial
    </Link>
  );
  if (query.isError)
    return (
      <div className="space-y-4">
        {back}
        <p role="alert">Não foi possível abrir esta oportunidade.</p>
        <button className={secondaryClass} onClick={() => query.refetch()}>
          Tentar novamente
        </button>
      </div>
    );
  if (!query.data) return <p role="status">Carregando oportunidade…</p>;
  const { op: selected, contact, stages, members } = query.data;
  return (
    <main className="mx-auto max-w-screen-xl space-y-5">
      {back}
      <header>
        <p className="text-sm text-muted-foreground">Oportunidade comercial</p>
        <h1 className="text-2xl font-semibold">{contact?.nome || selected.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {selected.title} · Responsável:{" "}
          {members.find((m) => m.id === selected.assigned_to)?.nome ?? "Sem responsável"}
        </p>
        {contact && (
          <Link
            className="text-sm text-primary underline"
            to="/leads/$id"
            params={{ id: String(contact.id) }}
          >
            Abrir ficha do lead
          </Link>
        )}
      </header>
      <nav
        aria-label="Seções da oportunidade"
        className="flex flex-wrap gap-4 text-sm font-medium text-primary xl:hidden"
      >
        <a href="#comercial">Comercial</a>
        {contact && modules.data?.atendimento_ia && <a href="#conversa">Conversa</a>}
        {contact && <a href="#atividades">Atividades e notas</a>}
      </nav>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div id="comercial" className="min-w-0 space-y-5 rounded-xl border bg-card p-4 sm:p-6">
          <label className="block text-sm font-medium">
            Etapa comercial
            <select
              aria-label="Etapa comercial"
              className={inputClass + " mt-2"}
              disabled={move.isPending}
              value={selected.stage_id}
              onChange={(e) => move.mutate(Number(e.target.value))}
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </select>
          </label>
          <OpportunityTags
            key={selected.id + "-tags"}
            companyId={companyId}
            opportunityId={selected.id}
          />
          <TaskWorkspace
            key={selected.id}
            companyId={companyId}
            leadId={selected.lead_id}
            opportunityId={selected.id}
            compact
          />
          <OpportunityHistory
            opportunity={selected}
            stages={stages}
            members={me ? [...members, me] : members}
          />
        </div>
        <div className="min-w-0 space-y-5">
          {contact && modules.data?.atendimento_ia && me && (
            <div id="conversa">
              <LeadConversation companyId={companyId} leadId={contact.id} actorId={me.id} />
            </div>
          )}
          {contact && (
            <div id="atividades">
              <LeadActivities companyId={companyId} leadId={contact.id} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
function OpportunityHistory({
  opportunity,
  stages,
  members,
}: {
  opportunity: Opportunity;
  stages: Stage[];
  members: Member[];
}) {
  const history = useQuery({
    queryKey: ["opportunity-events", opportunity.id, opportunity.version],
    queryFn: async () => {
      const { data, error } = await db
        .from("crm_opportunity_events")
        .select("id,kind,from_stage_id,to_stage_id,created_at,actor_id")
        .eq("opportunity_id", opportunity.id)
        .eq("id_empresa", opportunity.id_empresa)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">Histórico comercial</h3>
      {history.isPending ? (
        <p className="text-sm">Carregando…</p>
      ) : history.isError ? (
        <p className="text-sm text-red-700">Não foi possível carregar o histórico.</p>
      ) : (
        <ul className="max-h-52 space-y-3 overflow-y-auto">
          {history.data.map((event) => (
            <li key={event.id} className="border-l-2 border-primary/25 pl-3 text-sm">
              <p>
                {event.kind === "created"
                  ? "Oportunidade criada"
                  : `${stages.find((s) => s.id === event.from_stage_id)?.nome ?? "Etapa anterior"} → ${stages.find((s) => s.id === event.to_stage_id)?.nome ?? "Nova etapa"}`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(event.created_at).toLocaleString("pt-BR")} ·{" "}
                {members.find((m) => m.id === event.actor_id)?.nome ?? "Usuário não disponível"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
