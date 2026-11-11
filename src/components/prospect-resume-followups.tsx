import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { db } from "@/hml/modules";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Preview = { available: boolean; reason?: string; generation: number; steps: number[]; suggested_at: string; scheduled: { step: number; due_at: string }[] };
type Result = { scheduled: { step: number; due_at: string }[] };
const format = (value: string) => new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
export function ProspectResumeFollowups({ companyId, leadId, name }: { companyId: number; leadId: number; name: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" variant="outline" size="sm" className="h-9 w-9 shrink-0 p-0 lg:h-8 lg:w-auto lg:px-3" title="Retomar follow-ups" aria-label="Retomar follow-ups" onClick={() => setOpen(true)}>
      <CalendarClock className="h-4 w-4 lg:mr-2" /><span className="hidden lg:inline">Retomar follow-ups</span>
    </Button>
    {open && <ResumeDialog companyId={companyId} leadId={leadId} name={name} onClose={() => setOpen(false)} />}
  </>;
}
function ResumeDialog({ companyId, leadId, name, onClose }: { companyId: number; leadId: number; name: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [requestId] = useState(() => crypto.randomUUID());
  const preview = useQuery({
    queryKey: ["prospect-resume", companyId, leadId], staleTime: 0,
    queryFn: async () => {
      const { data, error } = await db.rpc("hub_resume_prospect_followups", { p_company: companyId, p_lead: leadId });
      if (error) throw error;
      return data as Preview;
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("hub_resume_prospect_followups", {
        p_company: companyId, p_lead: leadId,
        p_generation: preview.data?.generation, p_request: requestId,
      });
      if (error) throw error;
      return data as Result;
    },
    onSuccess: async () => { await qc.invalidateQueries({ predicate: q => q.queryKey[0] !== "prospect-resume" }); },
  });
  return <Dialog open onOpenChange={v => { if (!v && !save.isPending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
      <DialogHeader><DialogTitle>Confirmar retomada de follow-ups</DialogTitle><DialogDescription>{name}: somente as etapas que ainda não foram enviadas.</DialogDescription></DialogHeader>
      {save.data ? <>
        <p role="status" className="text-sm">Cadência agendada e conversa devolvida para a IA.</p>
        <ul className="space-y-2 text-sm">{save.data.scheduled.map(s => <li key={s.step}>Follow-up {s.step}: {format(s.due_at)}</li>)}</ul>
        <p className="text-xs text-muted-foreground">Horários de Brasília. Uma nova resposta ou a retomada do atendimento humano interrompe os envios pendentes.</p>
        <Button onClick={onClose}>Concluir</Button>
      </> : <>
        {preview.isPending && <p className="text-sm">Conferindo a cadência…</p>}
        {preview.error && <p role="alert" className="text-sm text-destructive">{preview.error.message}</p>}
        {preview.data && !preview.data.available && <p role="alert" className="text-sm">{preview.data.reason}</p>}
        {preview.data?.available && <form noValidate onSubmit={e => {
          e.preventDefault();
          save.mutate();
        }} className="space-y-4">
          <p className="text-sm">Etapas restantes: {preview.data.steps.map(s => `follow-up ${s}`).join(", ")}.</p>
          <p className="text-sm">O primeiro follow restante será agendado para 5 minutos após confirmar, ou para a próxima janela permitida.</p>
          <ul className="space-y-2 text-sm">{preview.data.scheduled?.map(s => <li key={s.step}>Follow-up {s.step}: {format(s.due_at)}</li>)}</ul>
          <p className="text-xs text-muted-foreground">Previsão em horário de Brasília, recalculada ao confirmar. Envios de segunda a sexta, das 8h às 18h50. O processamento pode levar alguns instantes.</p>
          <p className="text-sm">A conversa será devolvida para a IA. Os próximos follows mantêm os intervalos da cadência; mensagens já enviadas não serão repetidas.</p>
          <p className="text-xs text-muted-foreground">Use apenas quando fizer sentido voltar a contatar o lead. Pedidos de não receber mensagens permanecem bloqueados.</p>
          {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Cancelar</Button><Button disabled={save.isPending || preview.isFetching} type="submit">{save.isPending ? "Agendando…" : "Confirmar retomada"}</Button></div>
        </form>}
      </>}
    </DialogContent>
  </Dialog>;
}
