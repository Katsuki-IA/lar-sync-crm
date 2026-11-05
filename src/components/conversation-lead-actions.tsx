import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListFilter, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { db, inputClass, useCompanyModules, type Funnel, type Contact } from "@/hml/modules";
import { TaskEditor } from "@/hml/tasks";
import { useCrmUser } from "@/hooks/use-crm-user";
import { NewOpportunity } from "@/routes/_authenticated/crm";

export function ConversationLeadActions({
  companyId,
  leadId,
  name,
}: {
  companyId: number;
  leadId: number;
  name: string;
}) {
  const [open, setOpen] = useState<"stage" | "task" | null>(null);
  const { data: me } = useCrmUser();
  const { data: modules } = useCompanyModules(companyId);
  return (
    <>
      {modules?.crm && me?.active && me.role !== "analyst" && (
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          aria-label="Alterar estágio da oportunidade"
          title="Alterar estágio"
          onClick={() => setOpen("stage")}
        >
          <ListFilter size={18} />
        </Button>
      )}
      {modules?.crm && me?.active && me.role !== "analyst" && (
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          aria-label="Criar tarefa para este lead"
          title="Criar tarefa"
          onClick={() => setOpen("task")}
        >
          <CalendarPlus size={18} />
        </Button>
      )}
      {open && (
        <LeadActionDialog
          key={`${companyId}:${leadId}:${open}`}
          companyId={companyId}
          leadId={leadId}
          name={name}
          action={open}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function LeadActionDialog({
  companyId,
  leadId,
  name,
  action,
  onClose,
}: {
  companyId: number;
  leadId: number;
  name: string;
  action: "stage" | "task";
  onClose: () => void;
}) {
  const { data: me } = useCrmUser();
  const qc = useQueryClient();
  const [stage, setStage] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [funnelId, setFunnelId] = useState("");
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ["conversation-lead-action", companyId, leadId, action, me?.id],
    queryFn: async () => {
      const contact = await db
        .from("crm_leads")
        .select("id,nome,telefone,email,crm_assigned_to,crm_stage_id,updated_at")
        .eq("id_empresa", companyId)
        .eq("id", leadId)
        .single();
      if (contact.error) throw contact.error;
      if (action === "stage") {
        const stages = await db
          .from("crm_stages")
          .select("id,nome,id_funnel")
          .eq("id_empresa", companyId)
          .eq("module", "crm")
          .eq("ativo", true)
          .order("ordem");
        if (stages.error) throw stages.error;
        const [ops, funnels, members] = await Promise.all([
          db
            .from("crm_opportunities")
            .select("id,lead_id,title,assigned_to,stage_id,funnel_id,version")
            .eq("id_empresa", companyId)
            .eq("lead_id", leadId)
            .order("created_at"),
          db
            .from("crm_funnels")
            .select("id,id_empresa,nome,module,is_default")
            .eq("id_empresa", companyId)
            .eq("module", "crm")
            .eq("ativo", true)
            .order("ordem"),
          db
            .from("crm_users")
            .select("id,nome,role,active")
            .eq("id_empresa", companyId)
            .eq("active", true)
            .in("role", ["manager", "agent", "gestor", "corretor"])
            .order("nome"),
        ]);
        for (const r of [ops, funnels, members]) if (r.error) throw r.error;
        return {
          contact: contact.data,
          stages: stages.data,
          members: members.data!,
          opportunities: ops.data!,
          funnels: funnels.data! as Funnel[],
        };
      }
      const [members, opportunities] = await Promise.all([
        db
          .from("crm_users")
          .select("id,nome,role,active")
          .eq("id_empresa", companyId)
          .eq("active", true)
          .in("role", ["manager", "agent", "gestor", "corretor"])
          .order("nome"),
        db
          .from("crm_opportunities")
          .select("id,lead_id,title,assigned_to,stage_id,funnel_id,version")
          .eq("id_empresa", companyId)
          .eq("lead_id", leadId),
      ]);
      if (members.error) throw members.error;
      if (opportunities.error) throw opportunities.error;
      const people = members.data.map((m) => ({
        ...m,
        role: m.role === "gestor" ? "manager" : m.role === "corretor" ? "agent" : m.role,
      }));
      if (me?.role === "super_admin" && me.active && !people.some((m) => m.id === me.id))
        people.unshift({ ...me, active: true });
      return {
        contact: contact.data,
        stages: [],
        members: people,
        opportunities: opportunities.data,
        funnels: [] as Funnel[],
      };
    },
  });
  const selectedOpportunity =
    query.data?.opportunities.find((o) => o.id === opportunityId) ??
    (query.data?.opportunities.length === 1 ? query.data.opportunities[0] : undefined);
  const availableStages =
    query.data?.stages.filter((s) => s.id_funnel === selectedOpportunity?.funnel_id) ?? [];
  const selectedFunnel =
    query.data?.funnels.find((f) => String(f.id) === funnelId) ??
    query.data?.funnels.find((f) => f.is_default) ??
    query.data?.funnels[0];
  const save = useMutation({
    mutationFn: async () => {
      if (!selectedOpportunity || !availableStages.some((s) => String(s.id) === stage))
        throw new Error("Selecione um estágio válido.");
      const result = await db.rpc("hub_move_opportunity", {
        p_id: selectedOpportunity.id,
        p_stage_id: Number(stage),
        p_expected_version: selectedOpportunity.version,
      });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast.success("Estágio atualizado");
      onClose();
    },
    onError: async (error: Error) => {
      toast.error(error.message);
      await query.refetch();
    },
  });
  if (creating && query.data && selectedFunnel)
    return (
      <NewOpportunity
        open
        companyId={companyId}
        funnel={selectedFunnel}
        contacts={[query.data.contact as Contact]}
        members={query.data.members}
        defaultAssignee={query.data.contact.crm_assigned_to ?? ""}
        existingOnly
        onClose={() => {
          setCreating(false);
          void query.refetch();
        }}
      />
    );
  if (action === "task" && query.data)
    return (
      <TaskEditor
        companyId={companyId}
        leadId={leadId}
        task={null}
        context={{
          contacts: [query.data.contact],
          members: query.data.members,
          opportunities: query.data.opportunities,
        }}
        onClose={onClose}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{action === "stage" ? "Alterar estágio" : "Nova tarefa"}</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <p role="status">Carregando…</p>
        ) : query.isError ? (
          <div role="alert">
            <p>Não foi possível carregar os dados.</p>
            <Button variant="outline" onClick={() => query.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <p className="text-sm text-muted-foreground">
              Estágio do CRM comercial. Atual:{" "}
              {query.data.stages.find((s) => s.id === selectedOpportunity?.stage_id)?.nome ??
                "Sem estágio"}
              .
            </p>
            {query.data.opportunities.length > 1 && (
              <label className="block text-sm">
                Oportunidade
                <select
                  aria-label="Oportunidade para alterar"
                  required
                  className={inputClass + " mt-2 min-h-11 text-base"}
                  value={opportunityId}
                  disabled={save.isPending}
                  onChange={(e) => {
                    setOpportunityId(e.target.value);
                    setStage("");
                  }}
                >
                  <option value="">Selecione a oportunidade</option>
                  {query.data.opportunities.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!query.data.opportunities.length && (
              <div className="space-y-3">
                <p className="text-sm">
                  Este lead ainda não tem uma oportunidade comercial acessível.
                </p>
                {(me?.role === "super_admin" || me?.role === "manager") && selectedFunnel ? (
                  <>
                    <label className="block text-sm">
                      Funil
                      <select
                        aria-label="Funil da nova oportunidade"
                        className={inputClass + " mt-2"}
                        value={selectedFunnel.id}
                        onChange={(e) => setFunnelId(e.target.value)}
                      >
                        {query.data.funnels.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button type="button" onClick={() => setCreating(true)}>
                      Criar oportunidade
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Peça ao gestor para cadastrar uma oportunidade neste CRM.
                  </p>
                )}
              </div>
            )}
            <label className="block text-sm">
              Novo estágio
              <select
                aria-label="Novo estágio do lead"
                className={inputClass + " mt-2 min-h-11 text-base"}
                value={stage}
                required
                disabled={save.isPending || !selectedOpportunity}
                onChange={(e) => setStage(e.target.value)}
              >
                <option value="">Selecione o estágio</option>
                {availableStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </label>
            {selectedOpportunity && !availableStages.length && (
              <p role="alert">Nenhum estágio disponível nesta empresa.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  save.isPending ||
                  !stage ||
                  !selectedOpportunity ||
                  Number(stage) === selectedOpportunity.stage_id
                }
              >
                {save.isPending ? "Salvando…" : "Salvar estágio"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
