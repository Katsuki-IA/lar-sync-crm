import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Plus, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import {
  createSiteLeadSource,
  listSiteLeadSources,
  rotateSiteLeadSourceToken,
  setSiteLeadSourceActive,
  updateSiteLeadSource,
} from "@/lib/admin.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/admin/site-forms")({
  component: AdminSiteFormsPage,
});

const API_BASE_URL = "https://api.katsuki.com.br/functions/v1/site-lead-capture";

type Empresa = {
  id: number;
  nome: string | null;
};

type Empreendimento = {
  id: number;
  id_empresa: number;
  nome: string;
};

type SiteLeadSource = {
  id: string;
  id_empresa: number;
  id_empreendimento: number;
  nome: string;
  token: string;
  allowed_domains: string[] | null;
  origem: string | null;
  active: boolean;
  leads_count: number;
  last_lead_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function domainsFromText(value: string) {
  return value
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildEndpoint(token: string) {
  return `${API_BASE_URL}?token=${token}`;
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
  toast.success("Copiado");
}

function AdminSiteFormsPage() {
  const qc = useQueryClient();
  const listSourcesFn = useServerFn(listSiteLeadSources);
  const createSourceFn = useServerFn(createSiteLeadSource);

  const { data, isLoading } = useQuery({
    queryKey: ["admin_site_lead_sources"],
    queryFn: () => listSourcesFn(),
  });

  const empresas = (data?.empresas ?? []) as Empresa[];
  const empreendimentos = (data?.empreendimentos ?? []) as Empreendimento[];
  const sources = (data?.sources ?? []) as SiteLeadSource[];

  const [idEmpresa, setIdEmpresa] = useState("");
  const [idEmpreendimento, setIdEmpreendimento] = useState("");
  const [nome, setNome] = useState("");
  const [domains, setDomains] = useState("");

  useEffect(() => {
    if (!idEmpresa && empresas.length > 0) setIdEmpresa(String(empresas[0].id));
  }, [empresas, idEmpresa]);

  const filteredEmpreendimentos = useMemo(
    () => empreendimentos.filter((emp) => String(emp.id_empresa) === idEmpresa),
    [empreendimentos, idEmpresa],
  );

  const filteredSources = useMemo(
    () => sources.filter((source) => String(source.id_empresa) === idEmpresa),
    [sources, idEmpresa],
  );

  useEffect(() => {
    if (!filteredEmpreendimentos.some((emp) => String(emp.id) === idEmpreendimento)) {
      setIdEmpreendimento(filteredEmpreendimentos[0] ? String(filteredEmpreendimentos[0].id) : "");
    }
  }, [filteredEmpreendimentos, idEmpreendimento]);

  const createMutation = useMutation({
    mutationFn: async () =>
      createSourceFn({
        data: {
          id_empresa: Number(idEmpresa),
          id_empreendimento: Number(idEmpreendimento),
          nome,
          origem: "SI",
          allowed_domains: domainsFromText(domains),
        },
      }),
    onSuccess: async () => {
      toast.success("Fonte criada");
      setNome("");
      setDomains("");
      await qc.invalidateQueries({ queryKey: ["admin_site_lead_sources"] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? "Falha ao criar fonte");
    },
  });

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">Formulários externos</h2>
          <p className="text-sm text-muted-foreground">
            Crie uma URL segura para receber leads de formulários externos, como WordPress e Elementor.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[220px_260px_1fr_1fr_auto] lg:items-end">
          <div className="space-y-1.5">
            <Label>Empresa</Label>
            <Select value={idEmpresa} onValueChange={setIdEmpresa}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Empresa" />
              </SelectTrigger>
              <SelectContent>
                {empresas.map((empresa) => (
                  <SelectItem key={empresa.id} value={String(empresa.id)}>
                    {empresa.nome ?? `Empresa ${empresa.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Empreendimento</Label>
            <Select value={idEmpreendimento} onValueChange={setIdEmpreendimento}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Empreendimento" />
              </SelectTrigger>
              <SelectContent>
                {filteredEmpreendimentos.map((emp) => (
                  <SelectItem key={emp.id} value={String(emp.id)}>
                    {emp.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="site-source-name">Nome da fonte</Label>
            <Input
              id="site-source-name"
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              placeholder="Ex.: Site Modan 500"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="site-source-domains">Domínios permitidos</Label>
            <Input
              id="site-source-domains"
              value={domains}
              onChange={(event) => setDomains(event.target.value)}
              placeholder="exemplo.com.br, *.exemplo.com.br"
            />
          </div>

          <Button
            onClick={() => createMutation.mutate()}
            disabled={!idEmpresa || !idEmpreendimento || nome.trim().length < 2 || createMutation.isPending}
          >
            <Plus className="h-4 w-4" />
            Criar fonte
          </Button>
        </div>

        <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
          No Elementor, use a ação <span className="font-medium text-foreground">Webhook</span> e cole a URL gerada abaixo.
          Os campos são detectados por nomes comuns como <span className="font-mono">nome</span>,{" "}
          <span className="font-mono">telefone</span> e <span className="font-mono">email</span>.
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-medium">Fontes configuradas</h3>
            <p className="text-sm text-muted-foreground">
              Cada fonte tem um token próprio e pode ser desativada sem afetar as demais.
            </p>
          </div>
          {isLoading ? (
            <Badge variant="secondary">Carregando</Badge>
          ) : (
            <Badge variant="outline">{filteredSources.length} fonte(s)</Badge>
          )}
        </div>

        {filteredSources.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            Nenhuma fonte criada para esta empresa.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSources.map((source) => (
              <SiteLeadSourceRow
                key={source.id}
                source={source}
                empresa={empresas.find((empresa) => empresa.id === source.id_empresa)}
                empreendimento={empreendimentos.find((emp) => emp.id === source.id_empreendimento)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function SiteLeadSourceRow({
  source,
  empresa,
  empreendimento,
}: {
  source: SiteLeadSource;
  empresa?: Empresa;
  empreendimento?: Empreendimento;
}) {
  const qc = useQueryClient();
  const updateSourceFn = useServerFn(updateSiteLeadSource);
  const setActiveFn = useServerFn(setSiteLeadSourceActive);
  const rotateTokenFn = useServerFn(rotateSiteLeadSourceToken);

  const [nome, setNome] = useState(source.nome);
  const [domains, setDomains] = useState((source.allowed_domains ?? []).join(", "));

  useEffect(() => {
    setNome(source.nome);
    setDomains((source.allowed_domains ?? []).join(", "));
  }, [source.id, source.nome, source.allowed_domains]);

  const updateMutation = useMutation({
    mutationFn: async () =>
      updateSourceFn({
        data: {
          id: source.id,
          nome,
          origem: source.origem ?? "SI",
          allowed_domains: domainsFromText(domains),
        },
      }),
    onSuccess: async () => {
      toast.success("Fonte atualizada");
      await qc.invalidateQueries({ queryKey: ["admin_site_lead_sources"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "Falha ao atualizar fonte"),
  });

  const activeMutation = useMutation({
    mutationFn: async (active: boolean) => setActiveFn({ data: { id: source.id, active } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin_site_lead_sources"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "Falha ao alterar status"),
  });

  const rotateMutation = useMutation({
    mutationFn: async () => rotateTokenFn({ data: { id: source.id } }),
    onSuccess: async () => {
      toast.success("Token renovado");
      await qc.invalidateQueries({ queryKey: ["admin_site_lead_sources"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "Falha ao renovar token"),
  });

  const endpoint = buildEndpoint(source.token);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_auto] xl:items-start">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={source.active ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : ""} variant={source.active ? "secondary" : "outline"}>
              {source.active ? "Ativa" : "Inativa"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {empresa?.nome ?? `Empresa ${source.id_empresa}`} · {empreendimento?.nome ?? `Empreendimento ${source.id_empreendimento}`}
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={nome} onChange={(event) => setNome(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Domínios permitidos</Label>
              <Input
                value={domains}
                onChange={(event) => setDomains(event.target.value)}
                placeholder="exemplo.com.br, *.exemplo.com.br"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>URL do webhook</Label>
          <div className="flex gap-2">
            <Input value={endpoint} readOnly className="font-mono text-xs" />
            <Button type="button" variant="outline" size="icon" onClick={() => copyText(endpoint)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Alternativa: envie o token no header <span className="font-mono">x-hub-form-token</span>.
          </p>
          {source.last_error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Último erro: {source.last_error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
            <span>{source.active ? "Ativa" : "Inativa"}</span>
            <Switch
              checked={source.active}
              onCheckedChange={(active) => activeMutation.mutate(active)}
              disabled={activeMutation.isPending}
            />
          </div>
          <Button variant="outline" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
            <Save className="h-4 w-4" />
            Salvar
          </Button>
          <Button variant="outline" onClick={() => rotateMutation.mutate()} disabled={rotateMutation.isPending}>
            <RotateCcw className="h-4 w-4" />
            Renovar token
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-3">
        <div>
          <span className="block font-medium text-foreground">{source.leads_count ?? 0}</span>
          leads recebidos
        </div>
        <div>
          <span className="block font-medium text-foreground">{formatDate(source.last_lead_at)}</span>
          último lead
        </div>
        <div>
          <span className="block font-mono text-[11px] text-foreground">{source.id}</span>
          ID da fonte
        </div>
      </div>
    </div>
  );
}
