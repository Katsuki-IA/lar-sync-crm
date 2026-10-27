import { Button } from "@/components/ui/button";
import { calendarDays, dayKey, taskTypes } from "@/lib/task-presentation";
type CalendarTask = {
  id: string;
  titulo: string;
  prazo: string;
  tipo: string;
  prioridade: string;
  status: string;
};
export function TaskCalendar<T extends CalendarTask>({
  month,
  onMonth,
  tasks,
  onSelect,
}: {
  month: Date;
  onMonth: (month: Date) => void;
  tasks: T[];
  onSelect: (task: T) => void;
}) {
  const days = calendarDays(month);
  return (
    <section aria-label="Calendário de tarefas" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold capitalize" aria-live="polite">
          {month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
        </h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          >
            Mês anterior
          </Button>
          <Button variant="outline" onClick={() => onMonth(new Date())}>
            Hoje
          </Button>
          <Button
            variant="outline"
            onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          >
            Próximo mês
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <div className="min-w-[700px]">
          <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
              <div className="p-2" key={d}>
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const items = tasks.filter((t) => dayKey(new Date(t.prazo)) === dayKey(day));
              return (
                <div
                  key={dayKey(day)}
                  className={`min-h-28 border-b border-r p-2 ${day.getMonth() !== month.getMonth() ? "bg-muted/30" : ""}`}
                >
                  <p
                    className={`mb-2 text-xs ${dayKey(day) === dayKey(new Date()) ? "font-bold text-primary" : "text-muted-foreground"}`}
                  >
                    {day.getDate()}{" "}
                    {items.length > 0 && (
                      <span aria-label={`${items.length} tarefas`}>· {items.length}</span>
                    )}
                  </p>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {items.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => onSelect(task)}
                        className={`block w-full rounded border p-1.5 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary ${["concluida", "cancelada"].includes(task.status) ? "opacity-60 line-through" : task.prioridade === "alta" ? "border-primary/40 bg-primary/5" : "bg-background"}`}
                        aria-label={`Editar tarefa ${task.titulo}`}
                      >
                        <span className="font-semibold">
                          {new Date(task.prazo).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>{" "}
                        · {task.titulo}
                        <span className="mt-1 block text-muted-foreground">
                          {taskTypes[task.tipo]}
                          {task.prioridade === "alta" ? " · Alta" : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
