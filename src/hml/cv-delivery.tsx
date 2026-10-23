import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { sendLeadToExternalCrm } from "@/lib/external-crm.functions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function CvDelivery(_: { company: number; revision: number | string; canEdit: boolean }) {
  return <section className="space-y-3 rounded-xl border p-4">
    <h2 className="font-semibold">Integração com o CV</h2>
    <p className="text-sm">Os envios utilizam as credenciais e as regras do conector atual do HUB.</p>
    <Link to="/configuracoes/integracoes" className={buttonVariants({ variant: "outline" })}>Abrir integrações</Link>
  </section>;
}

// All external providers use the existing authenticated server operation.
// Its server-side checks resolve the company from the CRM lead ID.
export function CvSendDialog({ lead, name, onClose }: {
  company: number; lead: number; name: string; onClose: () => void;
}) {
  const send = useServerFn(sendLeadToExternalCrm);
  const qc = useQueryClient();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState("");
  async function submit() {
    if (inFlight.current || attempted) return;
    inFlight.current = true;
    setBusy(true);
    setAttempted(true);
    try {
      await send({ data: { lead_id: lead } });
      setMessage("Solicitação concluída pelo conector do HUB. Confira o histórico do lead.");
      await qc.invalidateQueries();
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : "Não foi possível confirmar o envio."} Confira o histórico antes de tentar novamente.`);
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent><DialogHeader><DialogTitle>Enviar lead ao CRM</DialogTitle>
      <DialogDescription>Confirma o envio de {name} ao CRM configurado para a empresa? Esta ação utiliza o conector atual e pode criar ou atualizar um cadastro externo.</DialogDescription>
    </DialogHeader>
    {message && <p role="status" className="text-sm">{message}</p>}
    <div className="flex justify-end gap-2">
      <Button variant="outline" disabled={busy} onClick={onClose}>Fechar</Button>
      <Button disabled={busy || attempted} onClick={() => void submit()}>{busy ? "Enviando…" : "Confirmar envio"}</Button>
    </div></DialogContent>
  </Dialog>;
}

