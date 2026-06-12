import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Search, Plus } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/leads/")({
  component: LeadsList,
});

const PAGE_SIZE = 25;

function LeadsList() {
  const { data: me } = useCrmUser();
  const { data: allowed } = useAllowedEmpresas();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<string>("all");
  const [tagId, setTagId] = useState<string>("all");
  const [empId, setEmpId] = useState<string>("all");
  const [userId, setUserId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);

  const filters = useMemo(
    () => ({ search, stage, tagId, empId, userId, dateFrom, dateTo, page }),
    [search, stage, tagId, empId, userId, dateFrom, dateTo, page],
  );

  const { data: meta } = useQuery({
    enabled: !!me && !!allowed,
    queryKey: ["leads-meta", me?.id_empresa, allowed],
    queryFn: async () => {
      const [{ data: stages }, { data: tags }, { data: emps }, { data: users }] = await Promise.all([
        supabase.from("crm_stages").select("id, nome, cor").eq("ativo", true).order("ordem"),
        supabase.from("crm_tags").select("id, nome, cor"),
        supabase.from("empreendimento").select("id, nome").in("id_empresa", allowed ?? []),
        supabase.from("crm_users").select("id, nome").in("id_empresa", allowed ?? []),
      ]);
      return { stages: stages ?? [], tags: tags ?? [], emps: emps ?? [], users: users ?? [] };
    },
  });

  const { data, isLoading } = useQuery({
    enabled: !!me && !!allowed,
    queryKey: ["leads-list", me?.id, me?.role, filters, allowed],
    queryFn: async () => {
      let leadIdsByTag: number[] | null = null;
      if (tagId !== "all") {
        const { data: links } = await supabase
          .from("crm_lead_tags")
          .select("lead_id")
          .eq("tag_id", Number(tagId));
        leadIdsByTag = (links ?? []).map((l) => l.lead_id);
        if (!leadIdsByTag.length) return { rows: [], count: 0 };
      }

      let q = supabase
        .from("lead")
        .select("id, nome, numero, email, crm_stage_id, crm_assigned_to, id_empreendimento, created_at", { count: "exact" })
        .in("id_empresa", allowed ?? []);

      if (me?.role === "agent") q = q.eq("crm_assigned_to", me.id);
      if (stage !== "all") q = q.eq("crm_stage_id", Number(stage));
      if (empId !== "all") q = q.eq("id_empreendimento", Number(empId));
      if (userId !== "all") q = q.eq("crm_assigned_to", userId);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo) q = q.lte("created_at", `${dateTo}T23:59:59`);
      if (search) q = q.or(`nome.ilike.%${search}%,numero.ilike.%${search}%`);
      if (leadIdsByTag) q = q.in("id", leadIdsByTag);

      q = q.order("created_at", { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data: rows, count, error } = await q;
      if (error) throw error;

      const leadIds = (rows ?? []).map((r) => r.id);
      const { data: tagLinks } = leadIds.length
        ? await supabase.from("crm_lead_tags").select("lead_id, tag_id").in("lead_id", leadIds)
        : { data: [] as { lead_id: number; tag_id: number }[] };
      const tagByLead = new Map<number, number[]>();
      for (const t of tagLinks ?? []) {
        const arr = tagByLead.get(t.lead_id) ?? [];
        arr.push(t.tag_id);
        tagByLead.set(t.lead_id, arr);
      }
      return { rows: (rows ?? []).map((r) => ({ ...r, tagIds: tagByLead.get(r.id) ?? [] })), count: count ?? 0 };
    },
  });

  const stageMap = new Map((meta?.stages ?? []).map((s) => [s.id, s]));
  const userMap = new Map((meta?.users ?? []).map((u) => [u.id, u.nome]));
  const empMap = new Map((meta?.emps ?? []).map((e) => [e.id, e.nome]));
  const tagMap = new Map((meta?.tags ?? []).map((t) => [t.id, t]));

  const total = data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">{total} no total</p>
        </div>
        <Button asChild className="rounded-xl">
          <Link to="/leads/new"><Plus className="h-4 w-4 mr-1" /> Novo lead</Link>
        </Button>
      </div>

      <Card className="p-4 rounded-2xl">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por nome ou telefone"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            />
          </div>
          <Select value={stage} onValueChange={(v) => { setStage(v); setPage(0); }}>
            <SelectTrigger><SelectValue placeholder="Estágio" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os estágios</SelectItem>
              {meta?.stages.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={tagId} onValueChange={(v) => { setTagId(v); setPage(0); }}>
            <SelectTrigger><SelectValue placeholder="Tag" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as tags</SelectItem>
              {meta?.tags.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={empId} onValueChange={(v) => { setEmpId(v); setPage(0); }}>
            <SelectTrigger><SelectValue placeholder="Empreendimento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {meta?.emps.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          {me?.role !== "agent" && (
            <Select value={userId} onValueChange={(v) => { setUserId(v); setPage(0); }}>
              <SelectTrigger><SelectValue placeholder="Corretor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {meta?.users.map((u) => <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} />
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} />
        </div>
      </Card>

      <Card className="rounded-2xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead className="hidden md:table-cell">Empreendimento</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Estágio</TableHead>
              <TableHead className="hidden lg:table-cell">Tags</TableHead>
              <TableHead className="hidden lg:table-cell">Criado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Carregando…</TableCell></TableRow>
            )}
            {!isLoading && !data?.rows.length && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhum lead encontrado</TableCell></TableRow>
            )}
            {data?.rows.map((l) => {
              const s = l.crm_stage_id ? stageMap.get(l.crm_stage_id) : undefined;
              return (
                <TableRow key={l.id} className="cursor-pointer hover:bg-muted/40">
                  <TableCell>
                    <Link to="/leads/$id" params={{ id: String(l.id) }} className="font-medium hover:text-primary">
                      {l.nome ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell>{l.numero ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">{l.email ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">{l.id_empreendimento ? empMap.get(l.id_empreendimento) ?? "—" : "—"}</TableCell>
                  <TableCell>{l.crm_assigned_to ? userMap.get(l.crm_assigned_to) ?? "—" : "—"}</TableCell>
                  <TableCell>
                    {s ? (
                      <Badge variant="secondary" style={{ backgroundColor: `${s.cor ?? "#f97316"}26`, color: s.cor ?? "#f97316" }}>
                        {s.nome}
                      </Badge>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {l.tagIds.map((tid) => {
                        const t = tagMap.get(tid);
                        if (!t) return null;
                        return (
                          <Badge key={tid} variant="secondary" className="text-[10px]" style={{ backgroundColor: `${t.cor ?? "#f97316"}26`, color: t.cor ?? "#f97316" }}>
                            {t.nome}
                          </Badge>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                    {l.created_at ? new Date(l.created_at).toLocaleDateString("pt-BR") : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Página {page + 1} de {pages}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
        </div>
      </div>
    </div>
  );
}