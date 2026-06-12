import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/leads/new")({
  component: NewLead,
});

function NewLead() {
  const { data: me } = useCrmUser();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    nome: "",
    numero: "",
    email: "",
    id_empreendimento: "",
    crm_assigned_to: "",
    crm_stage_id: "",
  });
  const [tagIds, setTagIds] = useState<Set<number>>(new Set());

  const { data: meta } = useQuery({
    enabled: !!me,
    queryKey: ["new-lead-meta", me?.id_empresa],
    queryFn: async () => {
      const [{ data: stages }, { data: tags }, { data: emps }, { data: users }] = await Promise.all([
        supabase.from("crm_stages").select("id, nome").eq("ativo", true).order("ordem"),
        supabase.from("crm_tags").select("id, nome, cor"),
        supabase.from("empreendimento").select("id, nome"),
        supabase.from("crm_users").select("id, nome").eq("active", true),
      ]);
      return { stages: stages ?? [], tags: tags ?? [], emps: emps ?? [], users: users ?? [] };
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      if (!me?.id_empresa) throw new Error("Empresa não definida");
      const insert = {
        id_empresa: me.id_empresa,
        nome: form.nome,
        numero: form.numero,
        email: form.email || null,
        id_empreendimento: form.id_empreendimento ? Number(form.id_empreendimento) : null,
        crm_assigned_to: form.crm_assigned_to || me.id,
        crm_stage_id: form.crm_stage_id ? Number(form.crm_stage_id) : null,
      };
      const { data: lead, error } = await supabase.from("lead").insert(insert).select("id").single();
      if (error) throw error;

      if (tagIds.size) {
        await supabase.from("crm_lead_tags").insert(
          [...tagIds].map((tid) => ({ lead_id: lead.id, tag_id: tid })),
        );
      }
      await supabase.from("crm_lead_activities").insert({
        lead_id: lead.id, crm_user_id: me.id, tipo: "system", descricao: "Lead criado via CRM",
      });
      return lead.id;
    },
    onSuccess: (id) => {
      toast.success("Lead criado");
      navigate({ to: "/leads/$id", params: { id: String(id) } });
    },
    onError: (e: Error) => toast.error("Erro ao criar lead", { description: e.message }),
  });

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Novo lead</h1>
      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">Informações</CardTitle></CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nome">
                <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
              </Field>
              <Field label="Telefone">
                <Input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} required />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Empreendimento">
                <Select value={form.id_empreendimento} onValueChange={(v) => setForm({ ...form, id_empreendimento: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>
                    {meta?.emps.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Responsável">
                <Select value={form.crm_assigned_to} onValueChange={(v) => setForm({ ...form, crm_assigned_to: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>
                    {meta?.users.map((u) => <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Estágio inicial">
                <Select value={form.crm_stage_id} onValueChange={(v) => setForm({ ...form, crm_stage_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>
                    {meta?.stages.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div>
              <Label className="mb-2 block">Tags</Label>
              <div className="flex flex-wrap gap-2">
                {meta?.tags.map((t) => {
                  const checked = tagIds.has(t.id);
                  return (
                    <label key={t.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border cursor-pointer text-sm ${checked ? "border-primary bg-primary/10" : "border-border"}`}>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(c) => {
                          const next = new Set(tagIds);
                          if (c) next.add(t.id); else next.delete(t.id);
                          setTagIds(next);
                        }}
                      />
                      <span style={{ color: t.cor ?? undefined }}>{t.nome}</span>
                    </label>
                  );
                })}
                {!meta?.tags.length && <span className="text-sm text-muted-foreground">Nenhuma tag cadastrada</span>}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => navigate({ to: "/leads" })}>Cancelar</Button>
              <Button type="submit" className="rounded-xl" disabled={createMut.isPending}>
                {createMut.isPending ? "Salvando…" : "Criar lead"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}