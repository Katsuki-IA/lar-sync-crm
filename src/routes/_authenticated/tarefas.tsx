import { createFileRoute } from "@tanstack/react-router";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { TaskWorkspace } from "@/hml/tasks";
export const Route = createFileRoute("/_authenticated/tarefas")({ component: TasksPage });
function TasksPage() {
  const { activeEmpresaId } = useActiveEmpresa();
  return activeEmpresaId ? (
    <TaskWorkspace key={activeEmpresaId} companyId={activeEmpresaId} />
  ) : null;
}

