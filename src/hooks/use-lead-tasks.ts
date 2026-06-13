import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";

export type TaskStatus = "pendente" | "em_andamento" | "concluida" | "vencida" | "cancelada";
export type TaskPriority = "baixa" | "normal" | "alta";

export type LeadTask = {
  id: string;
  id_empresa: number;
  lead_id: number;
  titulo: string;
  descricao: string | null;
  prioridade: TaskPriority;
  status: TaskStatus;
  prazo: string;
  assigned_to: string;
  created_by: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export function isEffectivelyOverdue(t: Pick<LeadTask, "status" | "prazo">) {
  if (t.status === "concluida" || t.status === "cancelada") return false;
  return new Date(t.prazo).getTime() < Date.now();
}

export function effectiveStatus(t: Pick<LeadTask, "status" | "prazo">): TaskStatus {
  if (isEffectivelyOverdue(t) && t.status !== "vencida") return "vencida";
  return t.status;
}

export function useLeadTasks(leadId: number | null | undefined) {
  return useQuery({
    enabled: !!leadId,
    queryKey: ["lead-tasks", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_lead_tasks")
        .select("*")
        .eq("lead_id", leadId!)
        .order("prazo", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LeadTask[];
    },
  });
}

export function useMyOverdueTasks() {
  const { data: me } = useCrmUser();
  return useQuery({
    enabled: !!me?.id,
    queryKey: ["my-overdue-tasks", me?.id],
    refetchInterval: 60_000,
    staleTime: 30_000,
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("crm_lead_tasks")
        .select("id,titulo,prazo,status,lead_id,prioridade,updated_at")
        .eq("assigned_to", me!.id)
        .in("status", ["pendente", "em_andamento", "vencida"])
        .lt("prazo", nowIso)
        .order("prazo", { ascending: true })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateLeadTask(leadId: number) {
  const qc = useQueryClient();
  const { data: me } = useCrmUser();
  return useMutation({
    mutationFn: async (input: {
      titulo: string;
      descricao?: string;
      prioridade: TaskPriority;
      prazo: string;
      assigned_to: string;
    }) => {
      if (!me?.id || !me.id_empresa) throw new Error("Sessão inválida");
      const { data, error } = await supabase
        .from("crm_lead_tasks")
        .insert({
          id_empresa: me.id_empresa,
          lead_id: leadId,
          titulo: input.titulo,
          descricao: input.descricao || null,
          prioridade: input.prioridade,
          prazo: input.prazo,
          assigned_to: input.assigned_to,
          created_by: me.id,
          status: "pendente",
        })
        .select("id")
        .single();
      if (error) throw error;
      await supabase.from("crm_lead_activities").insert({
        lead_id: leadId,
        crm_user_id: me.id,
        tipo: "task_create",
        descricao: `Tarefa criada: ${input.titulo}`,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-tasks", leadId] });
      qc.invalidateQueries({ queryKey: ["lead-activities", leadId] });
      qc.invalidateQueries({ queryKey: ["my-overdue-tasks"] });
    },
  });
}

export function useUpdateLeadTask(leadId: number) {
  const qc = useQueryClient();
  const { data: me } = useCrmUser();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status?: TaskStatus;
      titulo?: string;
      descricao?: string | null;
      prioridade?: TaskPriority;
      prazo?: string;
      assigned_to?: string;
    }) => {
      const patch: {
        status?: TaskStatus;
        completed_at?: string | null;
        titulo?: string;
        descricao?: string | null;
        prioridade?: TaskPriority;
        prazo?: string;
        assigned_to?: string;
      } = {};
      if (input.status !== undefined) {
        patch.status = input.status;
        patch.completed_at = input.status === "concluida" ? new Date().toISOString() : null;
      }
      if (input.titulo !== undefined) patch.titulo = input.titulo;
      if (input.descricao !== undefined) patch.descricao = input.descricao;
      if (input.prioridade !== undefined) patch.prioridade = input.prioridade;
      if (input.prazo !== undefined) patch.prazo = input.prazo;
      if (input.assigned_to !== undefined) patch.assigned_to = input.assigned_to;
      const { error } = await supabase.from("crm_lead_tasks").update(patch).eq("id", input.id);
      if (error) throw error;
      if (input.status && me?.id) {
        await supabase.from("crm_lead_activities").insert({
          lead_id: leadId,
          crm_user_id: me.id,
          tipo: "task_update",
          descricao: `Tarefa marcada como ${input.status}`,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-tasks", leadId] });
      qc.invalidateQueries({ queryKey: ["lead-activities", leadId] });
      qc.invalidateQueries({ queryKey: ["my-overdue-tasks"] });
    },
  });
}

export function useDeleteLeadTask(leadId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("crm_lead_tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-tasks", leadId] });
      qc.invalidateQueries({ queryKey: ["my-overdue-tasks"] });
    },
  });
}