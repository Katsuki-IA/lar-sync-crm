import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { encodeRecording } from "@/lib/encode-recording";

export function ConversationRecorder({ disabled, onReady, onBusy }: {
  disabled: boolean; onReady: (file: File) => void; onBusy: (busy: boolean) => void;
}) {
  const [state, setState] = useState<"idle" | "starting" | "recording" | "encoding">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const enabled = useRef(!disabled);
  enabled.current = !disabled;
  const stop = () => { if (recorder.current?.state === "recording") recorder.current.stop(); };
  useEffect(() => () => {
    generation.current++;
    if (recorder.current) { recorder.current.onstop = null; stop(); }
    stream.current?.getTracks().forEach(t => t.stop());
  }, []);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);
  useEffect(() => {
    if (state !== "recording") return;
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= 300) stop();
    }, 250);
    return () => clearInterval(timer);
  }, [state]);
  async function start() {
    const current = ++generation.current;
    setError(""); setState("starting"); onBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
        throw new Error("Este navegador não permite gravar. Você pode anexar um MP3 abaixo.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== generation.current || !enabled.current) {
        media.getTracks().forEach(t => t.stop());
        if (current === generation.current) { setState("idle"); onBusy(false); }
        return;
      }
      stream.current = media;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(t => MediaRecorder.isTypeSupported(t));
      const recording = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      recorder.current = recording;
      const parts: Blob[] = [];
      recording.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
      recording.onerror = () => { setError("A gravação foi interrompida. Tente novamente."); stop(); };
      recording.onstop = async () => {
        media.getTracks().forEach(t => t.stop());
        if (current !== generation.current) return;
        setState("encoding");
        try {
          const file = await encodeRecording(new Blob(parts, { type: recording.mimeType }));
          if (current === generation.current) onReady(file);
        } catch (e) { if (current === generation.current) setError((e as Error).message || "Não foi possível preparar o áudio."); }
        finally { if (current === generation.current) { setState("idle"); onBusy(false); } }
      };
      recording.start(); setSeconds(0); setState("recording");
    } catch (e) {
      stream.current?.getTracks().forEach(t => t.stop());
      if (current === generation.current) {
        setState("idle"); onBusy(false);
        setError((e as Error).name === "NotAllowedError" ? "Permita o microfone no navegador para gravar." : (e as Error).message);
      }
    }
  }
  return <div className="space-y-2">
    {state === "recording"
      ? <Button type="button" variant="destructive" onClick={stop}>Parar gravação · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</Button>
      : <Button type="button" variant="outline" disabled={disabled || state !== "idle"} onClick={() => void start()}>
          {state === "starting" ? "Aguardando microfone…" : state === "encoding" ? "Preparando áudio…" : "Iniciar gravação"}
        </Button>}
    <p className="text-xs text-muted-foreground">Até 5 minutos. Você poderá ouvir antes de enviar.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
