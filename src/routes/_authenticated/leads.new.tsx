import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/leads/new")({
  component: NewLead,
});

const COUNTRIES: { code: string; flag: string; ddi: string; name: string }[] = [
  { code: "BR", flag: "🇧🇷", ddi: "55", name: "Brasil" },
  { code: "US", flag: "🇺🇸", ddi: "1", name: "Estados Unidos" },
  { code: "PT", flag: "🇵🇹", ddi: "351", name: "Portugal" },
  { code: "AR", flag: "🇦🇷", ddi: "54", name: "Argentina" },
  { code: "CL", flag: "🇨🇱", ddi: "56", name: "Chile" },
  { code: "CO", flag: "🇨🇴", ddi: "57", name: "Colômbia" },
  { code: "MX", flag: "🇲🇽", ddi: "52", name: "México" },
  { code: "PY", flag: "🇵🇾", ddi: "595", name: "Paraguai" },
  { code: "UY", flag: "🇺🇾", ddi: "598", name: "Uruguai" },
  { code: "PE", flag: "🇵🇪", ddi: "51", name: "Peru" },
  { code: "BO", flag: "🇧🇴", ddi: "591", name: "Bolívia" },
  { code: "VE", flag: "🇻🇪", ddi: "58", name: "Venezuela" },
  { code: "EC", flag: "🇪🇨", ddi: "593", name: "Equador" },
  { code: "ES", flag: "🇪🇸", ddi: "34", name: "Espanha" },
  { code: "FR", flag: "🇫🇷", ddi: "33", name: "França" },
  { code: "DE", flag: "🇩🇪", ddi: "49", name: "Alemanha" },
  { code: "IT", flag: "🇮🇹", ddi: "39", name: "Itália" },
  { code: "GB", flag: "🇬🇧", ddi: "44", name: "Reino Unido" },
  { code: "CA", flag: "🇨🇦", ddi: "1", name: "Canadá" },
  { code: "JP", flag: "🇯🇵", ddi: "81", name: "Japão" },
  { code: "CN", flag: "🇨🇳", ddi: "86", name: "China" },
];

function maskPhoneBR(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function maskPhoneGeneric(value: string) {
  // Allow digits, spaces, parens, dashes; cap at 20 chars
  return value.replace(/[^\d\s()-]/g, "").slice(0, 20);
}

function NewLead() {
  const { data: me } = useCrmUser();
  const { data: allowed } = useAllowedEmpresas();
  const navigate = useNavigate();
  const [countryCode, setCountryCode] = useState("BR");
  const country = COUNTRIES.find((c) => c.code === countryCode) ?? COUNTRIES[0];
  const [form, setForm] = useState({
    nome: "",
    numero: "",
    email: "",
    id_empreendimento: "",
    crm_assigned_to: "",
    crm_stage_id: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const next: Record<string, string> = {};
    if (!form.nome.trim()) next.nome = "Nome é obrigatório";
    if (!form.numero.trim()) {
      next.numero = "Telefone é obrigatório";
    } else if (countryCode === "BR") {
      const digits = form.numero.replace(/\D/g, "");
      if (digits.length < 10) next.numero = "Telefone incompleto";
    }
    if (form.email.trim()) {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(form.email.trim())) next.email = "Email inválido";
    }
    if (!form.id_empreendimento) next.id_empreendimento = "Interesse é obrigatório";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  const { data: meta } = useQuery({
    enabled: !!me && !!allowed,
    queryKey: ["new-lead-meta", me?.id_empresa, allowed],
    queryFn: async () => {
      const [{ data: stages }, { data: emps }, { data: users }] = await Promise.all([
        supabase.from("crm_stages").select("id, nome, ordem").eq("ativo", true).order("ordem"),
        supabase.from("empreendimento").select("id, nome").in("id_empresa", allowed ?? []),
        supabase.from("crm_users").select("id, nome, role, created_at").eq("active", true).in("id_empresa", allowed ?? []).order("created_at", { ascending: true }),
      ]);
      return { stages: stages ?? [], emps: emps ?? [], users: users ?? [] };
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      if (!validate()) throw new Error("Corrija os campos indicados");
      if (!me?.id_empresa) throw new Error("Empresa não definida");
      // Default stage = first (lowest ordem)
      const defaultStageId = meta?.stages?.[0]?.id ?? null;
      // Default assignee = oldest manager
      const oldestManager = (meta?.users ?? []).find((u: any) => u.role === "manager");
      const defaultAssignee = oldestManager?.id ?? me.id;
      const insert = {
        id_empresa: me.id_empresa,
        id_crm: (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
        nome: form.nome,
        numero: form.numero ? `${country.ddi} ${form.numero}` : "",
        email: form.email || null,
        id_empreendimento: form.id_empreendimento ? Number(form.id_empreendimento) : null,
        crm_assigned_to: form.crm_assigned_to || defaultAssignee,
        crm_stage_id: form.crm_stage_id ? Number(form.crm_stage_id) : defaultStageId,
      };
      const { data: lead, error } = await supabase.from("lead").insert(insert).select("id").single();
      if (error) throw error;

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
                <div className="flex items-stretch rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0 overflow-hidden">
                  <Select value={countryCode} onValueChange={(v) => { setCountryCode(v); setForm((f) => ({ ...f, numero: "" })); }}>
                    <SelectTrigger className="h-auto w-auto gap-1.5 rounded-none border-0 border-r border-input bg-muted/50 px-2.5 text-sm text-muted-foreground focus:ring-0 focus:ring-offset-0">
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden className="text-base leading-none">{country.flag}</span>
                        <span className="font-medium">+{country.ddi}</span>
                      </span>
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          <span className="flex items-center gap-2">
                            <span aria-hidden>{c.flag}</span>
                            <span>{c.name}</span>
                            <span className="text-muted-foreground">+{c.ddi}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    placeholder={countryCode === "BR" ? "(ddd) 99999-9999" : "número"}
                    className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-none placeholder:text-muted-foreground/40"
                    value={form.numero}
                    onChange={(e) => setForm({ ...form, numero: countryCode === "BR" ? maskPhoneBR(e.target.value) : maskPhoneGeneric(e.target.value) })}
                    required
                  />
                </div>
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Interesse">
                <Select value={form.id_empreendimento} onValueChange={(v) => setForm({ ...form, id_empreendimento: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecionar empreendimento" /></SelectTrigger>
                  <SelectContent>
                    {meta?.emps.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Responsável">
                <Select value={form.crm_assigned_to} onValueChange={(v) => setForm({ ...form, crm_assigned_to: v })}>
                  <SelectTrigger><SelectValue placeholder="Gestor mais antigo (padrão)" /></SelectTrigger>
                  <SelectContent>
                    {meta?.users.map((u) => <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Estágio inicial">
                <Select value={form.crm_stage_id} onValueChange={(v) => setForm({ ...form, crm_stage_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Base (padrão)" /></SelectTrigger>
                  <SelectContent>
                    {meta?.stages.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
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