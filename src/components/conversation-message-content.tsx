import type { Json } from "@/integrations/supabase/types";
export function messageToText(message: Json | null): string {
  if (message == null) return "";
  if (typeof message === "string") return message;
  if (typeof message === "number" || typeof message === "boolean") return String(message);
  if (Array.isArray(message))
    return message
      .map((item) => messageToText(item))
      .filter(Boolean)
      .join("\n");

  const record = message as Record<string, Json>;
  const preferredKeys = ["content", "text", "message", "output", "body"];
  for (const key of preferredKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return JSON.stringify(message);
}

export function isToolMessage(type: string | null, message: Json | null) {
  if (type?.trim().toLowerCase() === "tool") return true;

  return /^calling\s+.+\s+with\s+input\s*:/i.test(messageToText(message).trim());
}

export function isEmptyInternalAiMessage(type: string | null, message: Json | null) {
  return type?.trim().toLowerCase() === "ai" && !messageToText(message).trim();
}

export function parseDateValue(value?: string | number | null) {
  if (!value) return "—";
  const raw = String(value).trim();
  if (!raw) return "—";

  const numeric = Number(raw);
  const date =
    Number.isFinite(numeric) && /^\d+$/.test(raw)
      ? new Date(raw.length <= 10 ? numeric * 1000 : numeric)
      : new Date(raw);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function MessageContent({ text }: { text: string }) {
  const parts = text.split(/(\[IMG\s*:\s*[^\]\s]+\s*\])/gi);

  return (
    <div className="space-y-2 leading-relaxed">
      {parts.map((part, index) => {
        const match = part.match(/^\[IMG\s*:\s*([^\]\s]+)\s*\]$/i);
        if (match) {
          const fileId = match[1];
          return (
            <a
              key={`${fileId}-${index}`}
              href={`https://drive.google.com/file/d/${fileId}/view`}
              target="_blank"
              rel="noreferrer"
              className="block w-fit max-w-full cursor-pointer overflow-hidden rounded-lg border bg-background shadow-sm"
              title="Abrir imagem"
            >
              <img
                src={`https://drive.google.com/thumbnail?id=${fileId}&sz=w600`}
                alt="Imagem enviada pela IA"
                className="block max-h-[360px] w-full max-w-[600px] object-contain"
                loading="lazy"
              />
            </a>
          );
        }

        return part ? (
          <span key={index} className="block whitespace-pre-wrap break-words">
            {part}
          </span>
        ) : null;
      })}
    </div>
  );
}
