import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ConfigHeader({ title, description, context }: { title: string; description: ReactNode; context?: ReactNode }) {
  return <header className="config-header space-y-2">
    <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
    {context && <p className="text-sm text-muted-foreground">{context}</p>}
    <p className="text-sm text-muted-foreground">{description}</p>
  </header>;
}

export function ConfigSection({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("config-surface space-y-6 rounded-xl border border-border bg-card p-5 sm:p-6", className)}>{children}</section>;
}

export function ConfigStatus({ children }: { children: ReactNode }) {
  return <span className="inline-flex shrink-0 items-center rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-foreground">{children}</span>;
}

export function ConfigTabs({ items, value, onChange, label }: { items: { value: string; label: string }[]; value: string; onChange: (value: string) => void; label: string }) {
  return <nav aria-label={label} className="config-tabs flex gap-6 overflow-x-auto border-b border-border">
    {items.map((item) => <Button key={item.value} type="button" variant="ghost" aria-pressed={value === item.value} onClick={() => onChange(item.value)} className={cn("h-11 shrink-0 rounded-none border-b-2 px-0 text-sm shadow-none hover:bg-transparent", value === item.value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>{item.label}</Button>)}
  </nav>;
}