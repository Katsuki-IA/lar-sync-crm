import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { Users, Flame, KanbanSquare, Building2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function MetricCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-3xl font-semibold tracking-tight">{value}</div>
            <div className="text-sm text-muted-foreground mt-1">{label}</div>
          </div>
          <div className="h-11 w-11 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const { data: me } = useCrmUser();
  const { data: allowed } = useAllowedEmpresas();

  const { data, isLoading } = useQuery({
    enabled: !!me && !!allowed,
    queryKey: ["dashboard", me?.id, me?.role, allowed],
    queryFn: async () => {
      const isAgent = me?.role === "agent";
      const empresaIds = allowed ?? [];

      const baseLeads = () => {
        let q = supabase
          .from("lead")
          .select("id, crm_stage_id, crm_assigned_to, id_empreendimento, lead_quente", { count: "exact" })
          .in("id_empresa", empresaIds);
        if (isAgent && me) q = q.eq("crm_assigned_to", me.id);
        return q;
      };

      const [{ data: leads, count }, { data: stages }, { data: users }, { data: emps }] = await Promise.all([
        baseLeads(),
        supabase.from("crm_stages").select("id, nome, cor, ordem").eq("ativo", true).order("ordem"),
        supabase.from("crm_users").select("id, nome").in("id_empresa", empresaIds),
        supabase.from("empreendimento").select("id, nome").in("id_empresa", empresaIds),
      ]);

      const byStage = (stages ?? []).map((s) => ({
        name: s.nome,
        cor: s.cor ?? "#f97316",
        total: (leads ?? []).filter((l) => l.crm_stage_id === s.id).length,
      }));

      const userMap = new Map((users ?? []).map((u) => [u.id, u.nome]));
      const byUser = Array.from(
        (leads ?? []).reduce((acc, l) => {
          const k = l.crm_assigned_to ?? "—";
          acc.set(k, (acc.get(k) ?? 0) + 1);
          return acc;
        }, new Map<string, number>()),
      ).map(([k, v]) => ({ name: userMap.get(k) ?? "Sem responsável", total: v }));

      const empMap = new Map((emps ?? []).map((e) => [e.id, e.nome]));
      const byEmp = Array.from(
        (leads ?? []).reduce((acc, l) => {
          const k = l.id_empreendimento ?? 0;
          acc.set(k, (acc.get(k) ?? 0) + 1);
          return acc;
        }, new Map<number, number>()),
      ).map(([k, v]) => ({ name: empMap.get(k) ?? "—", total: v }));

      const quentes = (leads ?? []).filter((l) => l.lead_quente).length;

      return { total: count ?? 0, quentes, byStage, byUser, byEmp, totalEmps: (emps ?? []).length };
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral dos seus leads</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total de leads" value={isLoading ? "…" : data?.total ?? 0} icon={Users} />
        <MetricCard label="Leads quentes" value={isLoading ? "…" : data?.quentes ?? 0} icon={Flame} />
        <MetricCard label="Estágios ativos" value={isLoading ? "…" : data?.byStage.length ?? 0} icon={KanbanSquare} />
        <MetricCard label="Empreendimentos" value={isLoading ? "…" : data?.totalEmps ?? 0} icon={Building2} />
      </div>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Leads por estágio</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.byStage ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={12} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 12 }} />
              <Bar dataKey="total" fill="#f97316" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Leads por corretor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.byUser ?? []).map((u) => (
              <div key={u.name} className="flex justify-between text-sm">
                <span>{u.name}</span>
                <span className="font-semibold">{u.total}</span>
              </div>
            ))}
            {!data?.byUser.length && <p className="text-sm text-muted-foreground">Sem dados</p>}
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Leads por empreendimento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.byEmp ?? []).map((e) => (
              <div key={e.name} className="flex justify-between text-sm">
                <span>{e.name}</span>
                <span className="font-semibold">{e.total}</span>
              </div>
            ))}
            {!data?.byEmp.length && <p className="text-sm text-muted-foreground">Sem dados</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}