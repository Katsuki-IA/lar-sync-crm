import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { db } from "@/hml/modules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Preview = { available: boolean; reason?: string; generation: number; steps: number[]; suggested_at: string };
type Result = { scheduled: { step: number; due_at: string }[] };
const format = (value: string) => new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
function localInput(value: string) {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
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
  const [date, setDate] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [validation, setValidation] = useState("");
  const preview = useQuery({
    queryKey: ["prospect-resume", companyId, leadId], staleTime: 0,
    queryFn: async () => {
      const { data, error } = await db.rpc("hub_resume_prospect_followups", { p_company: companyId, p_lead: leadId });
      if (error) throw error;
      return data as Preview;
    },
  });
  const chosen = date || (preview.data?.suggested_at ? localInput(preview.data.suggested_at) : "");
  const save = useMutation({
    mutationFn: async () => {
      // The field is explicitly São Paulo time, independent of the device timezone.
      const at = new Date(`${chosen}:00-03:00`);
      if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now()) throw new Error("Escolha uma data e um horário futuros.");
      const { data, error } = await db.rpc("hub_resume_prospect_followups", {
        p_company: companyId, p_lead: leadId, p_start: at.toISOString(),
        p_generation: preview.data?.generation, p_request: requestId,
      });
      if (error) throw error;
      return data as Result;
    },
    onSuccess: async () => { await qc.invalidateQueries({ predicate: q => q.queryKey[0] !== "prospect-resume" }); },
  });
  return <Dialog open onOpenChange={v => { if (!v && !save.isPending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
      <DialogHeader><DialogTitle>Retomar follow-ups</DialogTitle><DialogDescription>{name}: agende as etapas que ainda não foram enviadas.</DialogDescription></DialogHeader>
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
          if (!chosen) { setValidation("Informe a data e o horário."); return; }
          setValidation(""); save.mutate();
        }} className="space-y-4">
          <p className="text-sm">Etapas restantes: {preview.data.steps.map(s => `follow-up ${s}`).join(", ")}.</p>
          <div className="space-y-1">
            <label htmlFor="resume-followups-date" className="text-sm font-medium">Primeiro envio restante <span className="text-destructive">*</span></label>
            <Input id="resume-followups-date" type="datetime-local" value={chosen} disabled={save.isPending} required aria-invalid={!!validation} className={validation ? "border-red-500 bg-red-50" : ""} onChange={e => { setDate(e.target.value); setRequestId(crypto.randomUUID()); setValidation(""); save.reset(); }} />
            <p className="text-xs text-muted-foreground">Horário de Brasília. Fora de segunda a sexta, das 8h às 18h50, o envio passa para o próximo horário permitido.</p>
          </div>
          <p className="text-sm">A conversa será devolvida para a IA. Os próximos follows mantêm os intervalos da cadência; mensagens já enviadas não serão repetidas.</p>
          <p className="text-xs text-muted-foreground">Use apenas quando fizer sentido voltar a contatar o lead. Pedidos de não receber mensagens permanecem bloqueados.</p>
          {(validation || save.error) && <p role="alert" className="text-sm text-destructive">{validation || save.error?.message}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Cancelar</Button><Button disabled={save.isPending || preview.isFetching} type="submit">{save.isPending ? "Agendando…" : "Agendar retomada"}</Button></div>
        </form>}
      </>}
    </DialogContent>
  </Dialog>;
}
