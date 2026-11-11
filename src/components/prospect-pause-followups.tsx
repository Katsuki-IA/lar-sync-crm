import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pause } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/hml/modules";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function ProspectPauseFollowups({ companyId, leadId, name }: { companyId: number; leadId: number; name: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const pause = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("hub_pause_prospect_followups", { p_company: companyId, p_lead: leadId });
      if (error) throw error;
      return data as { paused: boolean; in_flight: boolean };
    },
    onSuccess: async result => {
      toast.success("Follow-ups pausados.");
      if (result.in_flight) toast.warning("Um envio já estava em andamento e ainda pode ser entregue. Os próximos estão pausados.");
      setOpen(false);
      await qc.invalidateQueries({ predicate: q => ["conversation-active-followups", "prospect-resume"].includes(String(q.queryKey[0])) });
    },
  });
  return <>
    <Button type="button" variant="outline" size="sm" className="h-9 w-9 shrink-0 p-0 lg:h-8 lg:w-auto lg:px-3" title="Pausar follow-ups" aria-label="Pausar follow-ups" onClick={() => { pause.reset(); setOpen(true); }}>
      <Pause className="h-4 w-4 lg:mr-2" /><span className="hidden lg:inline">Pausar follow-ups</span>
    </Button>
    <Dialog open={open} onOpenChange={v => { if (!pause.isPending) setOpen(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Pausar follow-ups?</DialogTitle><DialogDescription>{name}: os próximos follow-ups serão interrompidos. Nenhuma mensagem será enviada por esta ação, mesmo fora da janela de 24 horas.</DialogDescription></DialogHeader>
        <p className="text-sm">Você poderá reativar a cadência em “Retomar follow-ups”. O atendimento da conversa permanece como está.</p>
        {pause.error && <p role="alert" className="text-sm text-destructive">{pause.error.message}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={pause.isPending} onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={pause.isPending} onClick={() => pause.mutate()}>{pause.isPending ? "Pausando…" : "Confirmar pausa"}</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}
