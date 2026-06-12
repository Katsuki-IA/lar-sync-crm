import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2, Send, ExternalLink } from "lucide-react";

import { listEmpresas } from "@/lib/admin.functions";
import { sendNotification, listSentNotifications, deleteNotification } from "@/lib/notifications.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/notifications")({
  component: AdminNotificationsPage,
});

function AdminNotificationsPage() {
  const qc = useQueryClient();
  const listEmpresasFn = useServerFn(listEmpresas);
  const listSentFn = useServerFn(listSentNotifications);
  const sendFn = useServerFn(sendNotification);
  const deleteFn = useServerFn(deleteNotification);

  const { data: empresas = [] } = useQuery({
    queryKey: ["admin_empresas"],
    queryFn: () => listEmpresasFn(),
  });
  const { data: sent = [] } = useQuery({
    queryKey: ["admin_sent_notifications"],
    queryFn: () => listSentFn(),
  });

  const [titulo, setTitulo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [link, setLink] = useState("");
  const [allEmpresas, setAllEmpresas] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const mut = useMutation({
    mutationFn: () =>
      sendFn({
        data: {
          titulo,
          mensagem,
          link: link || undefined,
          all_empresas: allEmpresas,
          empresa_ids: allEmpresas ? [] : Array.from(selected),
        },
      }),
    onSuccess: (res) => {
      toast.success(`Notificação enviada para ${res.recipients} empresa(s).`);
      setTitulo("");
      setMensagem("");
      setLink("");
      setAllEmpresas(false);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["admin_sent_notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao enviar"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin_sent_notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Notificação removida");
    },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const empresaNameById = new Map(empresas.map((e) => [e.id as number, e.nome as string | null]));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card className="p-4 space-y-4 h-fit">
        <h2 className="text-lg font-medium">Nova notificação</h2>

        <div className="space-y-1.5">
          <Label htmlFor="titulo">Título *</Label>
          <Input id="titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mensagem">Mensagem *</Label>
          <Textarea
            id="mensagem"
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="Texto curto que aparecerá no painel do usuário"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="link">Link (opcional)</Label>
          <Input
            id="link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://..."
          />
        </div>

        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            <Checkbox
              id="all"
              checked={allEmpresas}
              onCheckedChange={(v) => setAllEmpresas(!!v)}
            />
            <Label htmlFor="all" className="cursor-pointer">Enviar para todas as empresas</Label>
          </div>

          {!allEmpresas && (
            <div className="rounded-md border border-border max-h-64 overflow-y-auto">
              {empresas.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">Nenhuma empresa.</div>
              ) : (
                empresas.map((e) => (
                  <label
                    key={e.id}
                    className="flex items-center gap-2 px-3 py-2 border-b border-border/60 last:border-0 cursor-pointer hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selected.has(e.id as number)}
                      onCheckedChange={() => toggle(e.id as number)}
                    />
                    <span className="text-sm flex-1">{e.nome ?? "—"}</span>
                    <span className="text-xs text-muted-foreground font-mono">#{e.id}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>

        <Button
          className="w-full"
          disabled={!titulo.trim() || !mensagem.trim() || mut.isPending}
          onClick={() => mut.mutate()}
        >
          <Send className="h-4 w-4 mr-2" />
          {mut.isPending ? "Enviando..." : "Enviar notificação"}
        </Button>
      </Card>

      <Card className="p-4">
        <h2 className="text-lg font-medium mb-3">Enviadas ({sent.length})</h2>
        {sent.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nenhuma notificação enviada ainda.</div>
        ) : (
          <div className="space-y-3 max-h-[700px] overflow-y-auto pr-1">
            {sent.map((n) => (
              <div key={n.id} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{n.titulo}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(n.created_at).toLocaleString("pt-BR")}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={() => {
                      if (confirm("Remover esta notificação?")) delMut.mutate(n.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-sm mt-1.5 whitespace-pre-wrap">{n.mensagem}</p>
                {n.link && (
                  <a
                    href={n.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary mt-1.5"
                  >
                    <ExternalLink className="h-3 w-3" /> {n.link}
                  </a>
                )}
                <div className="flex flex-wrap gap-1 mt-2">
                  {n.all_empresas ? (
                    <Badge variant="secondary">Todas as empresas</Badge>
                  ) : n.empresa_ids.length === 0 ? (
                    <Badge variant="outline">Sem destinatários</Badge>
                  ) : (
                    n.empresa_ids.map((id: number) => (
                      <Badge key={id} variant="secondary" className="text-[10px]">
                        {empresaNameById.get(id) ?? `#${id}`}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}