import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";

export type NotificationItem = {
  id: string;
  titulo: string;
  mensagem: string;
  link: string | null;
  created_at: string;
  read: boolean;
};

export function useNotifications() {
  const { data: me } = useCrmUser();
  return useQuery({
    enabled: !!me?.id,
    queryKey: ["notifications", me?.id],
    refetchInterval: 60_000,
    staleTime: 30_000,
    queryFn: async (): Promise<NotificationItem[]> => {
      const { data: notifs, error } = await supabase
        .from("crm_notifications")
        .select("id,titulo,mensagem,link,created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const ids = (notifs ?? []).map((n) => n.id);
      let readSet = new Set<string>();
      if (ids.length && me?.id) {
        const { data: reads } = await supabase
          .from("crm_notification_reads")
          .select("notification_id")
          .eq("crm_user_id", me.id)
          .in("notification_id", ids);
        readSet = new Set((reads ?? []).map((r: any) => r.notification_id as string));
      }
      return (notifs ?? []).map((n: any) => ({
        id: n.id,
        titulo: n.titulo,
        mensagem: n.mensagem,
        link: n.link,
        created_at: n.created_at,
        read: readSet.has(n.id),
      }));
    },
  });
}

export function useMarkNotificationRead() {
  const { data: me } = useCrmUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notification_id: string) => {
      if (!me?.id) return;
      await supabase
        .from("crm_notification_reads")
        .upsert({ notification_id, crm_user_id: me.id }, { onConflict: "notification_id,crm_user_id", ignoreDuplicates: true });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}