export const taskTypes: Record<string, string> = {
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  visita: "Visita",
  reuniao: "Reunião",
  follow_up: "Follow-up",
  outro: "Outro",
};
export const reminderOptions = [
  { value: 5, label: "5 minutos antes" },
  { value: 15, label: "15 minutos antes" },
  { value: 30, label: "30 minutos antes" },
  { value: 60, label: "1 hora antes" },
  { value: 1440, label: "1 dia antes" },
];
export function calendarDays(month: Date) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  start.setDate(start.getDate() - start.getDay());
  return Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}
export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function taskGroup(task: { prazo: string; status: string }, now: number) {
  if (["concluida", "cancelada"].includes(task.status)) return "Encerradas";
  const due = new Date(task.prazo);
  if (due.getTime() < now) return "Atrasadas";
  if (dayKey(due) === dayKey(new Date(now))) return "Hoje";
  return "Próximas";
}
