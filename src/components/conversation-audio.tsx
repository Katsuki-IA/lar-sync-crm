import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export function ConversationAudio({ leadId, chatId }: { leadId: number; chatId: number | string }) {
  const [playbackError, setPlaybackError] = useState(false);
  const audio = useQuery({
    queryKey: ["conversation-audio", leadId, chatId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("conversation-audio", {
        body: { leadId, chatId },
      });
      if (error || !data?.url) throw new Error("Não foi possível carregar o áudio.");
      setPlaybackError(false);
      return data as { url: string; mime: string; filename: string };
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });
  if (audio.isPending) return <p role="status" className="text-sm">Carregando áudio…</p>;
  if (audio.isError || !audio.data) return (
    <div className="text-sm">
      <p>Não foi possível carregar o áudio.</p>
      <Button variant="ghost" size="sm" onClick={() => void audio.refetch()}>Tentar novamente</Button>
    </div>
  );
  return (
    <div className="max-w-full space-y-1">
      <audio key={audio.data.url} controls preload="metadata" aria-label="Áudio recebido"
        className="w-64 max-w-full" src={audio.data.url} onError={() => setPlaybackError(true)} />
      {playbackError && <p className="text-xs">Não foi possível reproduzir neste navegador.
        <Button variant="ghost" size="sm" onClick={() => void audio.refetch()}>Recarregar áudio</Button>
      </p>}
      <a href={audio.data.url} target="_blank" rel="noreferrer" className="text-xs underline">Abrir áudio</a>
    </div>
  );
}
