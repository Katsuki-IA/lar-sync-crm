import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, Mic } from "lucide-react";
import { ConversationRecorder } from "@/components/conversation-recorder";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  MEDIA_BUCKET,
  MEDIA_HELP,
  validateMediaFile,
} from "../../supabase/functions/_shared/conversation-media";

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("whatsapp-conversation-send", { body });
  if (error) {
    let detail = error.message;
    if (error.context instanceof Response) {
      const result = await error.context
        .clone()
        .json()
        .catch(() => null);
      if (result?.error) detail = result.error;
    }
    throw new Error(detail);
  }
  if (!data?.ok) throw new Error("A Meta não confirmou o envio.");
  return data;
}

export function ConversationAttachmentComposer({
  leadId,
  canSend,
  onSent,
  audioOnly = false,
}: {
  leadId: number;
  canSend: boolean;
  onSent: () => void;
  audioOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [preview, setPreview] = useState("");
  const [validationError, setValidationError] = useState("");
  const [recordingBusy, setRecordingBusy] = useState(false);
  const uploaded = useRef<{ file: File; path: string; id: string } | null>(null);
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    const url = file && (file.type.startsWith("image/") || file.type.startsWith("audio/") || file.type === "video/mp4") ? URL.createObjectURL(file) : "";
    setPreview(url);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!file || !canSend)
        throw new Error(
          "Assuma a conversa e aguarde uma mensagem do cliente para abrir a janela de 24 horas.",
        );
      validateMediaFile(file.name, file.type, file.size);
      if (caption.length > 1024) throw new Error("A legenda deve ter no máximo 1.024 caracteres.");
      const common = {
        leadId,
        clientMessageId: requestId.current,
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      };
      let path = uploaded.current?.file === file ? uploaded.current.path : "";
      if (!path) {
        const result = await invoke({ ...common, action: "prepare_media" });
        const upload = await supabase.storage
          .from(MEDIA_BUCKET)
          .uploadToSignedUrl(result.path, result.token, file, { contentType: file.type });
        if (upload.error) throw new Error("Falha ao carregar o anexo: " + upload.error.message);
        path = result.path;
        uploaded.current = { file, path, id: requestId.current };
      }
      return invoke({ ...common, action: "send_media", storagePath: path, caption });
    },
    onSuccess: () => {
      setOpen(false);
      setFile(null);
      setCaption("");
      uploaded.current = null;
      requestId.current = crypto.randomUUID();
      onSent();
      toast.success("Anexo aceito pela Meta");
    },
    onError: (error: Error) =>
      toast.error("Não foi possível enviar o anexo", { description: error.message }),
  });
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={audioOnly ? "Gravar ou enviar áudio" : "Anexar imagem, vídeo ou PDF"}
        title={audioOnly ? "Gravar ou enviar áudio" : "Anexar imagem (5 MB), MP4 (16 MB) ou PDF (100 MB)"}
        disabled={!canSend}
        onClick={() => setOpen(true)}
      >
        {audioOnly ? <Mic className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!mutation.isPending) { setOpen(value); if (!value) { setRecordingBusy(false); setFile(null); uploaded.current = null; requestId.current = crypto.randomUUID(); } }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{audioOnly ? "Enviar áudio" : "Enviar imagem, vídeo ou PDF"}</DialogTitle>
            <DialogDescription>{audioOnly ? "Grave ou selecione um MP3 de até 16 MB. Envio na conversa assumida, dentro da janela de 24 horas." : MEDIA_HELP}</DialogDescription>
          </DialogHeader>
          {audioOnly && open && <ConversationRecorder disabled={!canSend || mutation.isPending}
            onBusy={busy => { setRecordingBusy(busy); if (busy) { setFile(null); uploaded.current = null; } }}
            onReady={recorded => { setFile(recorded); setValidationError(""); requestId.current = crypto.randomUUID(); }} />}
          <label className="space-y-2 text-sm">
            Arquivo
            <Input
              type="file"
              accept={audioOnly ? ".mp3,audio/mpeg" : ".jpg,.jpeg,.png,.mp4,.pdf,image/jpeg,image/png,video/mp4,application/pdf"}
              disabled={mutation.isPending || recordingBusy}
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                uploaded.current = null;
                requestId.current = crypto.randomUUID();
                setValidationError("");
                mutation.reset();
                setFile(null);
                if (selected)
                  try {
                    validateMediaFile(selected.name, selected.type, selected.size);
                    setFile(selected);
                  } catch (error) {
                    setValidationError((error as Error).message);
                  }
              }}
            />
          </label>
          {validationError || mutation.error ? (
            <p role="alert" className="text-sm text-destructive">
              {validationError || mutation.error?.message}
            </p>
          ) : null}
          {file ? (
            <div className="rounded-lg border bg-muted/30 p-3">
              {preview && audioOnly ? <audio controls src={preview} className="w-full" aria-label="Ouvir áudio antes de enviar" /> : preview && file.type === "video/mp4" ? <video controls playsInline preload="metadata" src={preview} className="mx-auto max-h-56 w-full rounded" aria-label="Prévia do vídeo" /> : preview ? (
                <img
                  src={preview}
                  alt="Prévia do anexo"
                  className="mx-auto max-h-56 object-contain"
                />
              ) : (
                <FileText className="mb-2 h-8 w-8" />
              )}
              <p className="mt-2 break-all text-sm">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
              {audioOnly && <Button variant="ghost" size="sm" disabled={mutation.isPending} onClick={() => { setFile(null); uploaded.current = null; requestId.current = crypto.randomUUID(); }}>Descartar áudio</Button>}
            </div>
          ) : null}
          {!audioOnly && <label className="space-y-2 text-sm">
            Legenda (opcional)
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={1024}
              disabled={mutation.isPending}
              placeholder="Adicione uma legenda ao arquivo"
            />
            <span className="text-xs text-muted-foreground">{caption.length}/1.024 caracteres</span>
          </label>}
          {!canSend ? (
            <p role="alert" className="text-sm text-destructive">
              A janela de atendimento está fechada ou esta conversa não está mais atribuída a você.
              Aguarde o cliente responder.
            </p>
          ) : null}
          <Button
            disabled={!file || !canSend || mutation.isPending || recordingBusy}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Carregando e enviando…" : audioOnly ? "Enviar áudio" : "Enviar anexo"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Attachment = {
  kind: "image" | "document" | "audio" | "video";
  storagePath: string;
  filename: string;
  caption?: string;
};
export function getConversationAttachment(message: unknown): Attachment | null {
  if (!message || typeof message !== "object" || !("attachment" in message)) return null;
  const a = (message as { attachment?: Partial<Attachment> }).attachment;
  return a &&
    (a.kind === "image" || a.kind === "document" || a.kind === "audio" || a.kind === "video") &&
    typeof a.storagePath === "string" &&
    typeof a.filename === "string"
    ? (a as Attachment)
    : null;
}
export function ConversationAttachment({ attachment }: { attachment: Attachment }) {
  const qc = useQueryClient();
  const queryKey = ["conversation-attachment-url", attachment.storagePath];
  const url = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await supabase.storage
        .from(MEDIA_BUCKET)
        .createSignedUrl(attachment.storagePath, 3600);
      if (result.error) throw result.error;
      return result.data.signedUrl;
    },
    staleTime: 45 * 60 * 1000,
    refetchInterval: 45 * 60 * 1000,
  });
  return (
    <div className="space-y-2">
      {url.data && attachment.kind === "video" ? <div className="space-y-1"><video controls playsInline preload="metadata" src={url.data} className="max-h-[360px] w-72 max-w-full rounded" aria-label="Vídeo enviado" /><a href={url.data} target="_blank" rel="noreferrer" className="block break-all text-xs underline">Abrir vídeo · {attachment.filename}</a></div> : url.data && attachment.kind === "audio" ? <audio controls preload="metadata" src={url.data} className="w-64 max-w-full" aria-label="Áudio enviado" /> : url.data ? (
        <a
          href={url.data}
          target="_blank"
          rel="noreferrer"
          className="block rounded-lg border bg-background/60 p-2"
          title="Abrir anexo"
        >
          {attachment.kind === "image" ? (
            <img
              src={url.data}
              alt={attachment.filename}
              loading="lazy"
              className="max-h-[360px] max-w-full rounded object-contain"
              onError={() => qc.invalidateQueries({ queryKey })}
            />
          ) : (
            <span className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Abrir PDF
            </span>
          )}
          <span className="mt-1 block break-all text-xs">{attachment.filename}</span>
        </a>
      ) : (
        <div className="text-sm">
          {attachment.filename}
          {url.isError ? (
            <Button size="sm" variant="link" onClick={() => url.refetch()}>
              Tentar abrir novamente
            </Button>
          ) : (
            <span className="block text-xs">Carregando anexo…</span>
          )}
        </div>
      )}
      {attachment.caption ? (
        <p className="whitespace-pre-wrap break-words">{attachment.caption}</p>
      ) : null}
    </div>
  );
}
