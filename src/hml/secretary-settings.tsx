import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { adminRpc, useAdminMutation } from "@/hml/administration";
import { inputClass } from "@/hml/modules";

type Channel = {
  provider: string;
  instance: string;
  enabled: boolean;
  autoSend: boolean;
  revision: number;
  baseUrl: string;
  hasCredential: boolean;
  inboundVerifiedAt: string | null;
  lastDispatchAt: string | null;
};
type Recipient = { memberId: string; name: string; phone: string | null; enabled: boolean };
type Settings = { channel: Channel | null; recipients: Recipient[] };

export function SecretarySettings({ companyId, isAdmin }: { companyId: number; isAdmin: boolean }) {
  const [edit, setEdit] = useState(false);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [webhook, setWebhook] = useState<string | null>(null);
  const [loadingWebhook, setLoadingWebhook] = useState(false);
  const query = useQuery<Settings>({
    queryKey: ["secretary-settings", companyId],
    refetchInterval: 15000,
    queryFn: () => adminRpc("hub_secretary_settings", { p_company_id: companyId }),
  });
  const automatic = useAdminMutation<boolean>(
    (enabled) =>
      adminRpc("hub_set_secretary_automation", { p_company_id: companyId, p_enabled: enabled }),
    "Automação atualizada",
  );
  const dispatch = useAdminMutation<void>(async () => {
    const count = await adminRpc("hub_request_secretary_dispatch", { p_company_id: companyId });
    if (!count)
      toast.info(
        "Nenhum envio disponível agora. Aguarde até um minuto se houve acionamento recente.",
      );
  }, "Verificação de envio solicitada");
  async function showWebhook() {
    setLoadingWebhook(true);
    try {
      setWebhook(
        JSON.stringify(
          await adminRpc("hub_secretary_webhook_setup", { p_company_id: companyId }),
          null,
          2,
        ),
      );
    } catch {
      toast.error("Não foi possível obter a configuração do webhook");
    } finally {
      setLoadingWebhook(false);
    }
  }
  if (query.isPending) return <p className="text-sm">Carregando configuração…</p>;
  if (query.isError)
    return (
      <Button variant="outline" onClick={() => query.refetch()}>
        Recarregar configuração
      </Button>
    );
  const c = query.data.channel;
  return (
    <section className="space-y-4 rounded-xl border bg-muted/20 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Settings2 className="size-4" />
            Conexão e automação
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {c
              ? `${c.provider === "uazapi" ? "Uazapi" : "Evolution"} · ${c.instance} · ${c.enabled ? "Habilitada" : "Pausada"}`
              : isAdmin
                ? "Configure o WhatsApp da secretária desta empresa."
                : "Solicite ao super admin a configuração da conexão da secretária."}
          </p>
        </div>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setEdit(true)}>
            {c ? "Editar conexão" : "Configurar conexão"}
          </Button>
        )}
      </header>
      {c && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-3 py-1 text-xs">
              {c.autoSend ? "Envio automático ativo" : "Envio automático pausado"}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={
                automatic.isPending || (!c.autoSend && (!c.enabled || !c.inboundVerifiedAt))
              }
              onClick={() => automatic.mutate(!c.autoSend)}
            >
              {c.autoSend ? "Pausar automação" : "Ativar automação"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!c.enabled || dispatch.isPending}
              onClick={() => dispatch.mutate()}
            >
              Enviar avisos pendentes
            </Button>
            {isAdmin && (
              <Button size="sm" variant="ghost" disabled={loadingWebhook} onClick={showWebhook}>
                Configurar webhook
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {c.inboundVerifiedAt
              ? "Aceite pelo WhatsApp validado. O processamento automático depende do agendamento configurado no servidor."
              : "Primeiro envie uma oferta e confirme o aceite pelo WhatsApp para liberar a automação."}
          </p>
          <div className="space-y-2 border-t pt-4">
            <h4 className="text-sm font-semibold">WhatsApp dos corretores</h4>
            <p className="text-xs text-muted-foreground">
              Use o WhatsApp do corretor reconhecido pelo provedor, com DDI.
            </p>
            {!query.data.recipients.length && (
              <p className="text-sm text-muted-foreground">
                Cadastre um corretor ativo na equipe para configurar o destinatário.
              </p>
            )}
            {query.data.recipients.map((r) => (
              <div
                key={r.memberId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3"
              >
                <div>
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.phone ? `+${r.phone}` : "Sem WhatsApp cadastrado"} ·{" "}
                    {r.enabled ? "Habilitado" : "Pausado"}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setRecipient(r)}>
                  Editar WhatsApp
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
      {edit && <ConnectionEditor companyId={companyId} channel={c} close={() => setEdit(false)} />}
      {recipient && (
        <RecipientEditor
          companyId={companyId}
          recipient={recipient}
          close={() => setRecipient(null)}
        />
      )}
      <Dialog
        open={webhook !== null}
        onOpenChange={(open) => {
          if (!open) setWebhook(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configuração do webhook</DialogTitle>
            <DialogDescription>
              Copie esta configuração para a instância exclusiva da empresa. Ela contém o segredo de
              recebimento e deve ser mantida privada.
            </DialogDescription>
          </DialogHeader>
          <textarea
            aria-label="Configuração privada do webhook"
            readOnly
            className={`${inputClass} min-h-72 font-mono text-xs`}
            value={webhook ?? ""}
          />
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(webhook ?? "");
                toast.success("Configuração copiada");
              } catch {
                toast.error("Selecione e copie o texto manualmente");
              }
            }}
          >
            Copiar configuração
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
function ConnectionEditor({
  companyId,
  channel,
  close,
}: {
  companyId: number;
  channel: Channel | null;
  close: () => void;
}) {
  const [provider, setProvider] = useState(channel?.provider ?? "evolution");
  const [instance, setInstance] = useState(channel?.instance ?? "");
  const [url, setUrl] = useState(channel?.baseUrl ?? "https://evolution.henaweb.com.br");
  const [key, setKey] = useState("");
  const [enabled, setEnabled] = useState(channel?.enabled ?? false);
  const save = useAdminMutation<void>(
    () =>
      adminRpc("hub_save_secretary", {
        p_company_id: companyId,
        p_provider: provider,
        p_instance: instance.trim(),
        p_base_url: url.trim().replace(/\/$/, ""),
        p_api_key: key.trim() || null,
        p_enabled: enabled,
        p_revision: channel?.revision ?? null,
      }),
    "Conexão salva",
    close,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conexão da secretária</DialogTitle>
          <DialogDescription>
            Use uma instância exclusiva. Trocar a conexão pausa a automação até validar um novo
            aceite.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <label className="block space-y-1 text-sm">
            Provedor
            <select
              aria-label="Provedor"
              className={inputClass}
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setUrl(e.target.value === "evolution" ? "https://evolution.henaweb.com.br" : "");
                setKey("");
              }}
            >
              <option value="evolution">Evolution</option>
              <option value="uazapi">Uazapi</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            Servidor
            <Input
              type="url"
              required
              value={url}
              placeholder="https://sua-empresa.uazapi.com"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            Nome exato da instância
            <Input
              required
              maxLength={100}
              value={instance}
              onChange={(e) => setInstance(e.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            {provider === "uazapi" ? "Token da instância" : "Chave da API"}
            <Input
              type="password"
              autoComplete="new-password"
              required={!channel?.hasCredential || provider !== channel?.provider}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                channel?.hasCredential
                  ? "Deixe vazio para manter a credencial"
                  : "Informe a credencial"
              }
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Habilitar conexão para envio e recebimento
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={close}>
              Cancelar
            </Button>
            <Button disabled={save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar conexão"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function RecipientEditor({
  companyId,
  recipient,
  close,
}: {
  companyId: number;
  recipient: Recipient;
  close: () => void;
}) {
  const [phone, setPhone] = useState(recipient.phone ?? "");
  const [enabled, setEnabled] = useState(recipient.enabled);
  const save = useAdminMutation<void>(
    () =>
      adminRpc("hub_save_secretary_recipient", {
        p_company_id: companyId,
        p_member: recipient.memberId,
        p_phone: phone.replace(/\D/g, ""),
        p_enabled: enabled,
      }),
    "WhatsApp atualizado",
    close,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>WhatsApp de {recipient.name}</DialogTitle>
          <DialogDescription>
            Confirme o número reconhecido pelo provedor. Ofertas abertas precisam ser encerradas
            antes de trocar o destinatário.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <label className="block space-y-1 text-sm">
            Número com DDI
            <Input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="55 + DDD + número"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Receber avisos da secretária
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={close}>
              Cancelar
            </Button>
            <Button disabled={save.isPending}>Salvar WhatsApp</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

