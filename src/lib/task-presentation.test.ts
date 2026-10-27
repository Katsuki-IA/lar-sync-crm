import { it, expect } from "vitest";
import { calendarDays, dayKey, taskGroup } from "./task-presentation";
it("covers complete calendar weeks across leap February and year boundaries", () => {
  const days = calendarDays(new Date(2024, 1, 15));
  expect(days).toHaveLength(42);
  expect(days[0].getDay()).toBe(0);
  expect(days[41].getDay()).toBe(6);
  expect(days.some((d) => dayKey(d) === "2024-02-29")).toBe(true);
  expect(calendarDays(new Date(2026, 0, 1))[0].getFullYear()).toBe(2025);
});
it("groups by overdue time and local day, keeping completed tasks separate", () => {
  const now = new Date(2026, 9, 27, 12).getTime();
  const make = (date: Date, status = "pendente") => ({ prazo: date.toISOString(), status });
  expect(taskGroup(make(new Date(2026, 9, 27, 11)), now)).toBe("Atrasadas");
  expect(taskGroup(make(new Date(2026, 9, 27, 13)), now)).toBe("Hoje");
  expect(taskGroup(make(new Date(2026, 9, 28, 0)), now)).toBe("Próximas");
  expect(taskGroup(make(new Date(2026, 9, 26), "concluida"), now)).toBe("Encerradas");
});
