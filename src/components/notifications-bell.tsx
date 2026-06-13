import { Bell, ExternalLink, AlertCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNotifications, useMarkNotificationRead } from "@/hooks/use-notifications";
import { useMyOverdueTasks } from "@/hooks/use-lead-tasks";
import { cn } from "@/lib/utils";

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function NotificationsBell() {
  const { data: items = [] } = useNotifications();
  const { data: overdue = [] } = useMyOverdueTasks();
  const markRead = useMarkNotificationRead();
  const unread = items.filter((n) => !n.read).length + overdue.length;

  function handleOpen(id: string, read: boolean, link: string | null) {
    if (!read) markRead.mutate(id);
    if (link) window.open(link, "_blank", "noopener,noreferrer");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9 relative" aria-label="Notificações">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 h-4 min-w-4 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center px-1">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm font-semibold">Notificações</span>
          <span className="text-xs text-muted-foreground">{unread} não lida{unread === 1 ? "" : "s"}</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {overdue.length > 0 && (
            <div>
              {overdue.map((t: any) => (
                <Link
                  key={`t-${t.id}`}
                  to="/leads/$id"
                  params={{ id: String(t.lead_id) }}
                  className="w-full text-left px-3 py-2.5 border-b border-border/60 hover:bg-muted/50 transition-colors flex gap-2 bg-destructive/5"
                >
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm truncate font-semibold">Tarefa vencida</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(t.prazo)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.titulo}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {items.length === 0 && overdue.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              Nenhuma notificação ainda.
            </div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => handleOpen(n.id, n.read, n.link)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border/60 hover:bg-muted/50 transition-colors flex gap-2",
                  !n.read && "bg-primary/5",
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 rounded-full shrink-0",
                    n.read ? "bg-transparent" : "bg-primary",
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("text-sm truncate", !n.read && "font-semibold")}>
                      {n.titulo}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(n.created_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 whitespace-pre-wrap">
                    {n.mensagem}
                  </p>
                  {n.link && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-primary mt-1">
                      <ExternalLink className="h-3 w-3" /> abrir link
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}