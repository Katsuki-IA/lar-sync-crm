import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Clock3, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useCompanyModules } from "@/hml/modules";
import { supabase } from "@/integrations/supabase/client";
import { offerCountdown, pendingOwnOffers } from "@/lib/offer-alert";
import type { SalesOffer } from "@/lib/sales-queue";

export function SalesOfferAlert() {
  const { activeEmpresaId } = useActiveEmpresa();
  const { data: me } = useCrmUser();
  const modules = useCompanyModules();
  if (
    !me?.active ||
    me.role !== "agent" ||
    me.id_empresa !== activeEmpresaId ||
    !modules.data?.crm ||
    modules.isError
  )
    return null;
  return (
    <OwnOfferAlert
      key={`${activeEmpresaId}:${me.id}`}
      companyId={activeEmpresaId!}
      memberId={me.id}
    />
  );
}

function OwnOfferAlert({ companyId, memberId }: { companyId: number; memberId: string }) {
  const qc = useQueryClient();
  const [now, setNow] = useState(Date.now);
  const [muted, setMuted] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const announced = useRef(new Set<string>());
  const responding = useRef(false);
  const queryKey = ["pending-sales-offers", companyId, memberId];
  const query = useQuery({
    queryKey,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from("hub_sales_offers")
        .select(
          "id,distribution_id,member_id,opportunity_title,status,expires_at,created_at,resolved_at",
        )
        .eq("id_empresa", companyId)
        .eq("member_id", memberId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("expires_at")
        .limit(100)
        .abortSignal(signal);
      if (error) throw error;
      return data;
    },
  });
  const offers = pendingOwnOffers(query.data ?? [], memberId, now);
  const offer = offers[0];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Browsers require a user gesture before audio can play. No permission prompt.
  useEffect(() => {
    let disposed = false;
    const unlock = () => {
      try {
        audio.current ??= new AudioContext();
        void audio.current
          .resume()
          .then(() => {
            if (!disposed) setSoundReady(audio.current?.state === "running");
          })
          .catch(() => {});
      } catch {
        /* Visual offers remain available when audio is unsupported. */
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      disposed = true;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      void audio.current?.close().catch(() => {});
      audio.current = null;
    };
  }, []);

  useEffect(() => {
    if (!query.data || query.isError) return;
    const fresh = pendingOwnOffers(query.data, memberId, Date.now()).filter(
      (o) => !announced.current.has(o.id),
    );
    if (!fresh.length || (!muted && !soundReady)) return;
    for (const o of fresh) announced.current.add(o.id);
    const ctx = audio.current;
    if (muted || !ctx || ctx.state !== "running") return;
    const tone = ctx.createOscillator();
    const gain = ctx.createGain();
    tone.type = "sine";
    tone.frequency.setValueAtTime(880, ctx.currentTime);
    tone.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    tone.connect(gain);
    gain.connect(ctx.destination);
    tone.onended = () => {
      tone.disconnect();
      gain.disconnect();
    };
    tone.start();
    tone.stop(ctx.currentTime + 0.4);
  }, [query.data, query.isError, memberId, muted, soundReady]);

  const answer = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "accept" | "decline" }) => {
      const { data, error } = await supabase.rpc("hub_respond_sales_offer", {
        p_offer: id,
        p_action: action,
      });
      if (error) throw error;
      return data as { status: string };
    },
    onSuccess: (result, { id }) => {
      qc.setQueryData<SalesOffer[]>(queryKey, (rows) => rows?.filter((o) => o.id !== id));
      if (result.status === "accepted")
        toast.success("Lead aceito! A oportunidade está no seu CRM.");
      else if (result.status === "declined") toast.info("Oferta recusada.");
      else toast.info("Esta oferta já foi encerrada ou o prazo terminou.");
    },
    onError: () =>
      toast.error("Não foi possível registrar sua resposta. Confira a conexão e tente novamente."),
    onSettled: async () => {
      await qc.invalidateQueries();
      responding.current = false;
    },
  });

  if (!offer) return null;
  return (
    <OfferAlertCard
      offer={offer}
      now={now}
      count={offers.length}
      busy={answer.isPending}
      muted={muted}
      soundReady={soundReady}
      connectionError={query.isError}
      onToggleSound={() => setMuted((value) => (soundReady ? !value : false))}
      onAnswer={(action) => {
        if (responding.current || Date.parse(offer.expires_at) <= Date.now()) return;
        responding.current = true;
        answer.mutate({ id: offer.id, action });
      }}
    />
  );
}

export function OfferAlertCard({
  offer,
  now,
  count,
  busy,
  muted,
  soundReady,
  connectionError,
  onToggleSound,
  onAnswer,
}: {
  offer: SalesOffer;
  now: number;
  count: number;
  busy: boolean;
  muted: boolean;
  soundReady: boolean;
  connectionError: boolean;
  onToggleSound: () => void;
  onAnswer: (action: "accept" | "decline") => void;
}) {
  const expired = Date.parse(offer.expires_at) <= now;
  return (
    <aside
      aria-label="Nova oferta de lead"
      className="fixed bottom-4 right-4 z-40 w-[calc(100%-2rem)] max-w-sm rounded-2xl border bg-card p-5 text-card-foreground shadow-xl md:bottom-6 md:right-6"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <p
          role="status"
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"
        >
          <BellRing className="size-4" /> Novo lead para você
        </p>
        <span
          role="timer"
          aria-label="Tempo restante para aceitar"
          className="flex items-center gap-1.5 text-sm font-semibold tabular-nums"
        >
          <Clock3 className="size-4" />
          {offerCountdown(offer.expires_at, now)}
        </span>
      </div>
      <h2 className="break-words text-lg font-semibold">{offer.opportunity_title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Uma nova oportunidade chegou na sua vez. Aceite para assumir o atendimento.
      </p>
      {count > 1 && (
        <p className="mt-2 text-xs font-medium">
          {count} ofertas aguardando você. Exibindo a que vence primeiro.
        </p>
      )}
      {connectionError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          Sem atualização no momento. Tentando reconectar…
        </p>
      )}
      <div className="mt-5 flex gap-2">
        <Button
          className="flex-1"
          disabled={busy || expired || connectionError}
          onClick={() => onAnswer("accept")}
        >
          <Check className="size-4" />
          {busy ? "Registrando…" : "Aceitar lead"}
        </Button>
        <Button
          variant="outline"
          disabled={busy || expired || connectionError}
          onClick={() => onAnswer("decline")}
        >
          Recusar
        </Button>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Se você não responder, a fila tentará o próximo corretor disponível.
      </p>
      <button
        type="button"
        onClick={onToggleSound}
        aria-pressed={!muted}
        className="mt-3 flex items-center gap-1.5 rounded text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
        {muted || !soundReady ? "Ativar som" : "Silenciar aviso"}
      </button>
    </aside>
  );
}
