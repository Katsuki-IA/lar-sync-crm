import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { KanbanView } from "@/components/kanban-view";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useFunnels } from "@/hooks/use-funnels";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/kanban")({
  component: KanbanPage,
});

function KanbanPage() {
  const { data: me } = useCrmUser();
  const { data: funnels = [] } = useFunnels(me?.id_empresa);
  const [funnelId, setFunnelId] = useState<number | null>(null);
  useEffect(() => {
    if (funnelId == null && funnels.length) {
      const def = funnels.find((f) => f.is_default) ?? funnels[0];
      setFunnelId(def.id);
    }
  }, [funnels, funnelId]);
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-foreground">Kanban</h1>
          <p className="text-sm text-muted-foreground mt-1">Arraste os leads entre os estágios</p>
        </div>
        {funnels.length > 0 && (
          <Select value={funnelId ? String(funnelId) : ""} onValueChange={(v) => setFunnelId(Number(v))}>
            <SelectTrigger className="h-9 w-[220px]"><SelectValue placeholder="Funil" /></SelectTrigger>
            <SelectContent>
              {funnels.map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>
                  {f.nome}{f.is_default ? " (padrão)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <KanbanView funnelId={funnelId} />
    </div>
  );
}