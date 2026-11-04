import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BellRing, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { supabase } from "@/integrations/supabase/client";
import {
  isProspectNoticeRecipient,
  loadProspectNotices,
  type ProspectNotice,
} from "@/lib/prospect-reply-alert";

export function ProspectReplyAlert() {
  const { data: me, isError } = useCrmUser();
  // Do not mount polling or audio until the current CRM identity is confirmed.
  if (isError || !me || !isProspectNoticeRecipient(me)) return null;
  return <RecipientReplyAlert key={me.id} memberId={me.id} />;
}

function RecipientReplyAlert({ memberId }: { memberId: string }) {
  const { empresas, setActiveEmpresaId } = useActiveEmpresa();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const audio = useRef<AudioContext | null>(null);
  const announced = useRef(new Set<string>());
  const opening = useRef(false);
  const [soundReady, setSoundReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryKey = ["katsuki-prospect-notices", memberId];
  const query = useQuery({
    queryKey,
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    queryFn: () => loadProspectNotices({ id: memberId, active: true }, async () => {
      const { data, error } = await supabase.rpc("hub_kp_notices");
      if (error?.code === "PGRST202" || error?.code === "42883") return [];
      if (error) throw error;
      return (data ?? []) as unknown as ProspectNotice[];
    }),
  });
  const notices = query.data ?? [];
  const first = notices[0];

  const unlockSound = () => {
    try {
      audio.current ??= new AudioContext();
      const ctx = audio.current;
      void ctx.resume().then(() => {
        if (audio.current === ctx) setSoundReady(ctx.state === "running");
      }).catch(() => {});
    } catch {
      /* O aviso visual permanece disponível sem suporte a áudio. */
    }
  };

  useEffect(() => {
    const unlock = () => {
      try {
        audio.current ??= new AudioContext();
        const ctx = audio.current;
        void ctx.resume().then(() => {
          if (audio.current === ctx) setSoundReady(ctx.state === "running");
        }).catch(() => {});
      } catch {
        /* O aviso visual permanece disponível sem suporte a áudio. */
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      void audio.current?.close().catch(() => {});
      audio.current = null;
    };
  }, []);

  useEffect(() => {
    const ctx = audio.current;
    if (!soundReady || query.isError || !ctx || ctx.state !== "running") return;
    const fresh = (query.data ?? []).filter(n => !announced.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach(n => announced.current.add(n.id));
    const tone = ctx.createOscillator();
    const gain = ctx.createGain();
    tone.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    tone.connect(gain);
    gain.connect(ctx.destination);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    tone.start();
    tone.stop(ctx.currentTime + 0.4);
  }, [query.data, query.isError, soundReady]);

  if (!first) return null;
  const open = async () => {
    if (opening.current || query.isError) return;
    if (!empresas.some(e => e.id === first.company_id)) {
      toast.error("Selecione uma empresa à qual você tenha acesso.");
      return;
    }
    opening.current = true;
    setBusy(true);
    try {
      setActiveEmpresaId(first.company_id);
      await navigate({ to: "/conversas", search: { lead: String(first.lead_id) } });
      const { data, error } = await supabase.rpc("hub_kp_notice_seen", { p_id: first.id });
      if (error) throw error;
      if (data !== true) throw new Error("Aviso não confirmado");
      await qc.invalidateQueries({ queryKey });
    } catch {
      toast.error("Não foi possível abrir ou confirmar o aviso. Tente novamente.");
    } finally {
      opening.current = false;
      setBusy(false);
    }
  };

  return (
    <aside aria-label="Resposta positiva da prospecção" className="fixed bottom-4 right-4 z-40 w-[calc(100%-2rem)] max-w-sm rounded-2xl border bg-card p-5 text-card-foreground shadow-xl md:bottom-6 md:right-6">
      <p role="status" className="flex items-center gap-2 text-sm font-semibold text-primary"><BellRing className="size-4 shrink-0" /> Interessado em conhecer a IA</p>
      <h2 className="mt-3 break-words text-lg font-semibold">{first.lead_name}</h2>
      <p className="mt-1 break-words text-sm text-muted-foreground">{first.company_name}</p>
      <p className="mt-3 text-sm">A automação está pausada. Abra a conversa e use “Assumir conversa” para continuar pelo mesmo número.</p>
      {notices.length > 1 && <p className="mt-2 text-xs">{notices.length} interessados aguardando atendimento.</p>}
      <Button className="mt-4 w-full" disabled={busy || query.isError} onClick={() => void open()}>{busy ? "Abrindo…" : "Abrir conversa no Hub"}</Button>
      {!soundReady && <Button variant="ghost" className="mt-2" onClick={unlockSound}><Volume2 className="size-4" /> Ativar som</Button>}
    </aside>
  );
}