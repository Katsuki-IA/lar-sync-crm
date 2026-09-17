import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Plus, KeyRound, Pencil, Ban } from "lucide-react";
import { toast } from "sonner";
import {
  listReportingIntegrations,
  saveReportingIntegration,
  changeReportingToken,
} from "@/lib/reporting.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/admin/reporting-api")({
  component: ReportingApiPage,
});

type Integration = {
  id: string;
  nome: string;
  empresa_ids: number[];
  token_prefix: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
};
type Form = { id?: string; nome: string; empresa_ids: number[]; expiration: string };
const emptyForm = (): Form => ({
  nome: "",
  empresa_ids: [],
  expiration: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
});
const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "—";

function ReportingApiPage() {
  const queryClient = useQueryClient();
  const list = useServerFn(listReportingIntegrations);
  const save = useServerFn(saveReportingIntegration);
  const changeToken = useServerFn(changeReportingToken);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const [form, setForm] = useState<Form>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ item: Integration; action: "rotate" | "revoke" } | null>(
    null,
  );
  const query = useQuery({ queryKey: ["reporting-integrations"], queryFn: () => list() });
  const companies = query.data?.companies ?? [];
  const integrations = query.data?.integrations ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["reporting-integrations"] });
  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: form.id,
          nome: form.nome,
          empresa_ids: form.empresa_ids,
          expires_at: form.expiration
            ? new Date(`${form.expiration}T23:59:59-03:00`).toISOString()
            : null,
        },
      }),
    onSuccess: (result) => {
      setFormOpen(false);
      if (result.token) setToken(result.token);
      toast.success(result.token ? "Integração criada" : "Permissões atualizadas");
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const tokenMutation = useMutation({
    mutationFn: (value: { id: string; action: "rotate" | "revoke" }) =>
      changeToken({ data: value }),
    onSuccess: (result) => {
      setConfirm(null);
      if (result.token) setToken(result.token);
      toast.success(result.token ? "Token substituído" : "Acesso revogado");
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copiado");
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie o texto.");
    }
  }
  function edit(item: Integration) {
    const date = item.expires_at
      ? new Date(new Date(item.expires_at).getTime() - 3 * 3600000).toISOString().slice(0, 10)
      : "";
    setForm({ id: item.id, nome: item.nome, empresa_ids: item.empresa_ids, expiration: date });
    setFormOpen(true);
  }
  const endpoint = `${origin}/api/integrations/leads`;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">API de relatórios</h2>
          <p className="text-sm text-muted-foreground">
            Conecte sistemas de relatórios aos leads do Hub. Cada integração acessa somente as
            empresas selecionadas.
          </p>
        </div>
        <Button
          onClick={() => {
            setForm(emptyForm());
            setFormOpen(true);
          }}
          disabled={!companies.length}
        >
          <Plus className="mr-2 h-4 w-4" />
          Nova integração
        </Button>
      </div>
      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Somente leitura</Badge>
          <span className="text-sm">Acesso pelo servidor do sistema integrado</span>
        </div>
        <Label htmlFor="reporting-endpoint">Endpoint</Label>
        <div className="flex gap-2">
          <Input id="reporting-endpoint" value={endpoint} readOnly />
          <Button variant="outline" aria-label="Copiar endpoint" onClick={() => copy(endpoint)}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Use o token no header <code>Authorization: Bearer SEU_TOKEN</code>. Informe a empresa, as
          datas e o fuso. Até 100 leads por página.
        </p>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            Exemplo de consulta e campos disponíveis
          </summary>
          <pre className="mt-3 overflow-x-auto rounded bg-muted p-3 text-xs">{`GET ${endpoint}?id_empresa=ID_EMPRESA&data_inicio=2026-09-09&data_fim=2026-09-15&fuso=America%2FSao_Paulo&limite=100\nAuthorization: Bearer SEU_TOKEN`}</pre>
          <p className="mt-3">
            O retorno inclui identificação do lead, chave de pessoa, origem, empreendimento,
            situação e etapa do CRM, anúncios e campanhas, IDs Meta e CV, última mensagem e
            temperatura disponível.
          </p>
          <p className="mt-2 text-muted-foreground">
            Quando <code>tem_mais</code> for verdadeiro, repita a consulta com{" "}
            <code>antes_de_id=proximo_antes_de_id</code>. As datas filtram a criação do lead; os
            demais dados representam a situação atual. O fuso padrão é São Paulo; também é aceito
            UTC. Limite de 60 consultas por minuto por integração.
          </p>
        </details>
      </Card>
      {query.isLoading && <p className="text-sm text-muted-foreground">Carregando integrações…</p>}
      {query.error && (
        <Card className="p-5">
          <p className="text-destructive">{query.error.message}</p>
          <Button variant="outline" className="mt-3" onClick={() => query.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      )}
      {!query.isLoading && !query.error && !integrations.length && (
        <Card className="p-8 text-center text-muted-foreground">
          Nenhuma integração cadastrada. Crie a primeira para gerar um token.
        </Card>
      )}
      <div className="grid gap-4">
        {integrations.map((item) => {
          const expired = !!item.expires_at && Date.parse(item.expires_at) <= Date.now();
          const status = item.revoked_at ? "Revogada" : expired ? "Expirada" : "Ativa";
          return (
            <Card key={item.id} className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold">{item.nome}</h3>
                  <Badge variant={status === "Ativa" ? "secondary" : "outline"}>{status}</Badge>
                </div>
                <code className="text-xs text-muted-foreground">{item.token_prefix}…</code>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.empresa_ids.map((id) => (
                  <Badge variant="outline" key={id}>
                    {companies.find((company) => company.id === id)?.nome ?? `Empresa ${id}`}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <span>
                  Validade: {item.expires_at ? formatDate(item.expires_at) : "Sem expiração"}
                </span>
                <span>
                  Último uso:{" "}
                  {item.last_used_at ? formatDate(item.last_used_at) : "Ainda não utilizado"}
                </span>
              </div>
              {!item.revoked_at && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => edit(item)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Editar acesso
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirm({ item, action: "rotate" })}
                  >
                    <KeyRound className="mr-2 h-4 w-4" />
                    Substituir token
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirm({ item, action: "revoke" })}
                  >
                    <Ban className="mr-2 h-4 w-4" />
                    Revogar
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <Dialog
        open={formOpen}
        onOpenChange={(value) => {
          if (!saveMutation.isPending) setFormOpen(value);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Editar integração" : "Nova integração de relatórios"}
            </DialogTitle>
            <DialogDescription>
              Escolha quais empresas este sistema poderá consultar.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveMutation.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="integration-name">Nome da integração</Label>
              <Input
                id="integration-name"
                placeholder="Ex.: Pulse — Inocoop"
                value={form.nome}
                minLength={2}
                maxLength={100}
                required
                onChange={(event) => setForm({ ...form, nome: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="integration-expiry">Válido até</Label>
              <Input
                id="integration-expiry"
                type="date"
                value={form.expiration}
                onChange={(event) => setForm({ ...form, expiration: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Deixe vazio para não expirar. O acesso pode ser revogado a qualquer momento.
              </p>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Empresas autorizadas</legend>
              <div className="max-h-60 space-y-2 overflow-y-auto rounded border p-3">
                {companies.map((company) => (
                  <label
                    key={company.id}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={form.empresa_ids.includes(company.id)}
                      onCheckedChange={(checked) =>
                        setForm({
                          ...form,
                          empresa_ids: checked
                            ? [...new Set([...form.empresa_ids, company.id])]
                            : form.empresa_ids.filter((id) => id !== company.id),
                        })
                      }
                    />
                    {company.nome}
                  </label>
                ))}
              </div>
            </fieldset>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                disabled={saveMutation.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saveMutation.isPending || !form.empresa_ids.length}>
                {saveMutation.isPending
                  ? "Salvando…"
                  : form.id
                    ? "Salvar acesso"
                    : "Criar e gerar token"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={token !== null}
        onOpenChange={(open) => {
          if (!open) setToken(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token gerado</DialogTitle>
            <DialogDescription>
              Copie agora e salve nos segredos do servidor integrado. O token completo é mostrado
              somente nesta tela.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Token de integração"
            value={token ?? ""}
            readOnly
            className="font-mono text-xs"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => copy(token ?? "")}>
              <Copy className="mr-2 h-4 w-4" />
              Copiar token
            </Button>
            <Button onClick={() => setToken(null)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !tokenMutation.isPending) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.action === "rotate" ? "Substituir token" : "Revogar acesso"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.action === "rotate"
                ? `O token atual de ${confirm.item.nome} deixará de funcionar. Atualize o sistema integrado com o novo token. A validade e as empresas serão mantidas.`
                : `O sistema ${confirm?.item.nome} perderá acesso à API. Esta integração continuará no histórico como revogada.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={tokenMutation.isPending}
              onClick={() => setConfirm(null)}
            >
              Cancelar
            </Button>
            <Button
              disabled={tokenMutation.isPending}
              onClick={() => {
                if (confirm) tokenMutation.mutate({ id: confirm.item.id, action: confirm.action });
              }}
            >
              {tokenMutation.isPending ? "Salvando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
