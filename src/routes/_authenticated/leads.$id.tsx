import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Flame, ArrowLeft, Send, Plus, X, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LeadTasksCard } from "@/components/lead-tasks-card";

export const Route = createFileRoute("/_authenticated/leads/$id")({
  component: LeadDetail,
});

function LeadDetail() {
  const { id } = Route.useParams();
  const leadId = Number(id);
  const { data: me } = useCrmUser();
  const { data: allowed } = useAllowedEmpresas();
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const { data: lead, isLoading } = useQuery({
    enabled: !!me,
    queryKey: ["lead", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead")
        .select("id, nome, numero, email, id_empreendimento, crm_stage_id, crm_assigned_to, lead_quente, qualificado, created_at")
        .eq("id", leadId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: meta } = useQuery({
    enabled: !!me && !!allowed,
    queryKey: ["lead-meta", me?.id_empresa, allowed],
    queryFn: async () => {
      const [{ data: stages }, { data: tags }, { data: emps }, { data: users }] = await Promise.all([
        supabase.from("crm_stages").select("id, nome, cor").eq("ativo", true).order("ordem"),
        supabase.from("crm_tags").select("id, nome, cor"),
        supabase.from("empreendimento").select("id, nome").in("id_empresa", allowed ?? []),
        supabase.from("crm_users").select("id, nome").eq("active", true).in("id_empresa", allowed ?? []),
      ]);
      return { stages: stages ?? [], tags: tags ?? [], emps: emps ?? [], users: users ?? [] };
    },
  });

  const { data: tagLinks } = useQuery({
    enabled: !!leadId,
    queryKey: ["lead-tags", leadId],
    queryFn: async () => {
      const { data } = await supabase.from("crm_lead_tags").select("tag_id").eq("lead_id", leadId);
      return (data ?? []).map((t) => t.tag_id);
    },
  });

  const { data: activities } = useQuery({
    enabled: !!leadId,
    queryKey: ["lead-activities", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_lead_activities")
        .select("id, tipo, descricao, created_at, crm_user_id")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const stageMut = useMutation({
    mutationFn: async (newStageId: number) => {
      const fromName = meta?.stages.find((s) => s.id === lead?.crm_stage_id)?.nome ?? "—";
      const toName = meta?.stages.find((s) => s.id === newStageId)?.nome ?? "—";
      const { error } = await supabase.from("lead").update({ crm_stage_id: newStageId }).eq("id", leadId);
      if (error) throw error;
      await supabase.from("crm_lead_activities").insert({
        lead_id: leadId, crm_user_id: me!.id, tipo: "stage_change", descricao: `De ${fromName} para ${toName}`,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead", leadId] });
      qc.invalidateQueries({ queryKey: ["lead-activities", leadId] });
      toast.success("Estágio atualizado");
    },
  });

  const assignMut = useMutation({
    mutationFn: async (uid: string) => {
      const toName = meta?.users.find((u) => u.id === uid)?.nome ?? "—";
      const { error } = await supabase.from("lead").update({ crm_assigned_to: uid }).eq("id", leadId);
      if (error) throw error;
      await supabase.from("crm_lead_activities").insert({
        lead_id: leadId, crm_user_id: me!.id, tipo: "assignment", descricao: `Atribuído a ${toName}`,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead", leadId] });
      qc.invalidateQueries({ queryKey: ["lead-activities", leadId] });
      toast.success("Responsável atualizado");
    },
  });

  const toggleTagMut = useMutation({
    mutationFn: async ({ tagId, add }: { tagId: number; add: boolean }) => {
      const tagName = meta?.tags.find((t) => t.id === tagId)?.nome ?? "tag";
      if (add) {
        const { error } = await supabase.from("crm_lead_tags").insert({ lead_id: leadId, tag_id: tagId });
        if (error) throw error;
        await supabase.from("crm_lead_activities").insert({
          lead_id: leadId, crm_user_id: me!.id, tipo: "tag_add", descricao: `Tag adicionada: ${tagName}`,
        });
      } else {
        const { error } = await supabase.from("crm_lead_tags").delete().eq("lead_id", leadId).eq("tag_id", tagId);
        if (error) throw error;
        await supabase.from("crm_lead_activities").insert({
          lead_id: leadId, crm_user_id: me!.id, tipo: "tag_remove", descricao: `Tag removida: ${tagName}`,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-tags", leadId] });
      qc.invalidateQueries({ queryKey: ["lead-activities", leadId] });
    },
  });

  const noteMut = useMutation({
    mutationFn: async (text: string) => {
      const { error } = await supabase.from("crm_lead_activities").insert({
        lead_id: leadId, crm_user_id: me!.id, tipo: "note", descricao: text,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["lead-activities", leadId] });
      toast.success("Nota adicionada");
    },
  });

  if (isLoading || !lead) return <p className="text-muted-foreground">Carregando…</p>;

  const empNome = lead.id_empreendimento ? meta?.emps.find((e) => e.id === lead.id_empreendimento)?.nome : null;
  const stage = meta?.stages.find((s) => s.id === lead.crm_stage_id);
  const userMap = new Map((meta?.users ?? []).map((u) => [u.id, u.nome]));
  const isManager = me?.role !== "agent";

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon"><Link to="/leads"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{lead.nome ?? "Sem nome"}</h1>
            {lead.lead_quente && (
              <Badge className="bg-primary/15 text-primary border-0"><Flame className="h-3 w-3 mr-1" /> Quente</Badge>
            )}
            {lead.qualificado ? (
              <Badge variant="secondary">Qualificado</Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{lead.numero} · {lead.email ?? "sem email"}</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-4">
          <LeadTasksCard leadId={leadId} users={meta?.users ?? []} />
          <Card className="rounded-2xl">
            <CardHeader><CardTitle className="text-base">Atividade</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Textarea
                  placeholder="Adicionar nota..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="min-h-20"
                />
                <Button
                  className="self-end rounded-xl"
                  disabled={!note.trim() || noteMut.isPending}
                  onClick={() => noteMut.mutate(note.trim())}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-3 pt-2">
                {(activities ?? []).map((a) => (
                  <div key={a.id} className="flex gap-3 pb-3 border-b border-border last:border-0">
                    <div className="h-2 w-2 rounded-full bg-primary mt-2 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">{labelTipo(a.tipo)}</span>
                        <span className="text-xs text-muted-foreground">{a.created_at ? new Date(a.created_at).toLocaleString("pt-BR") : ""}</span>
                      </div>
                      <p className="text-sm mt-0.5">{a.descricao}</p>
                      {a.crm_user_id && <p className="text-xs text-muted-foreground mt-1">por {userMap.get(a.crm_user_id) ?? "—"}</p>}
                    </div>
                  </div>
                ))}
                {!activities?.length && <p className="text-sm text-muted-foreground">Nenhuma atividade ainda.</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="rounded-2xl">
            <CardHeader><CardTitle className="text-base">Detalhes</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Field label="Empreendimento" value={empNome ?? "—"} />
              <div>
                <label className="text-xs text-muted-foreground">Estágio</label>
                <Select value={lead.crm_stage_id ? String(lead.crm_stage_id) : ""} onValueChange={(v) => stageMut.mutate(Number(v))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Selecionar">
                      {stage && <span style={{ color: stage.cor ?? undefined }}>{stage.nome}</span>}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {meta?.stages.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Responsável</label>
                {isManager ? (
                  <Select value={lead.crm_assigned_to ?? ""} onValueChange={(v) => assignMut.mutate(v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Atribuir" /></SelectTrigger>
                    <SelectContent>
                      {meta?.users.map((u) => <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="mt-1">{lead.crm_assigned_to ? userMap.get(lead.crm_assigned_to) ?? "—" : "—"}</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">Tags</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 px-2"><Plus className="h-3 w-3" /></Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-60 p-2">
                      <div className="space-y-1">
                        {meta?.tags.map((t) => {
                          const has = tagLinks?.includes(t.id);
                          return (
                            <button
                              key={t.id}
                              onClick={() => toggleTagMut.mutate({ tagId: t.id, add: !has })}
                              className={`w-full text-left px-2 py-1.5 rounded-md text-sm hover:bg-muted ${has ? "font-medium" : ""}`}
                            >
                              <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: t.cor ?? "#f97316" }} />
                              {t.nome} {has && "✓"}
                            </button>
                          );
                        })}
                        {!meta?.tags.length && <p className="text-xs text-muted-foreground px-2 py-1">Nenhuma tag</p>}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {(tagLinks ?? []).map((tid) => {
                    const t = meta?.tags.find((x) => x.id === tid);
                    if (!t) return null;
                    return (
                      <Badge key={tid} variant="secondary" className="gap-1" style={{ backgroundColor: `${t.cor ?? "#f97316"}26`, color: t.cor ?? "#f97316" }}>
                        {t.nome}
                        <button onClick={() => toggleTagMut.mutate({ tagId: tid, add: false })}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                  {!tagLinks?.length && <span className="text-xs text-muted-foreground">Sem tags</span>}
                </div>
              </div>

              <Field label="Criado em" value={lead.created_at ? new Date(lead.created_at).toLocaleString("pt-BR") : "—"} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function labelTipo(t: string) {
  switch (t) {
    case "note": return "Nota";
    case "stage_change": return "Estágio";
    case "assignment": return "Atribuição";
    case "tag_add": return "Tag";
    case "tag_remove": return "Tag";
    case "system": return "Sistema";
    default: return t;
  }
}