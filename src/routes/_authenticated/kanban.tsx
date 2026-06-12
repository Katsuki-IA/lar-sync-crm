import { createFileRoute } from "@tanstack/react-router";
import { KanbanView } from "@/components/kanban-view";

export const Route = createFileRoute("/_authenticated/kanban")({
  component: KanbanPage,
});

function KanbanPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-bold tracking-tight text-foreground">Kanban</h1>
        <p className="text-sm text-muted-foreground mt-1">Arraste os leads entre os estágios</p>
      </div>
      <KanbanView />
    </div>
  );
}