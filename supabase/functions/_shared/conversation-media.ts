export const MEDIA_BUCKET = "conversation-attachments";
export const MEDIA_HELP =
  "Limites da Meta: JPG/PNG até 5 MB e PDF até 100 MB. Legenda até 1.024 caracteres. Envio apenas nas 24 horas após a última mensagem do cliente.";
export type MediaKind = "image" | "document";
export function validateMediaFile(name: string, mime: string, size: number): MediaKind {
  const image = mime === "image/jpeg" || mime === "image/png";
  const pdf = mime === "application/pdf";
  if ((!image && !pdf) || !(image ? /\.(jpe?g|png)$/i : /\.pdf$/i).test(name))
    throw new Error("Selecione uma imagem JPG/PNG ou um documento PDF.");
  const limit = (image ? 5 : 100) * 1024 * 1024;
  if (!Number.isSafeInteger(size) || size <= 0)
    throw new Error("O arquivo está vazio ou possui tamanho inválido.");
  if (size > limit)
    throw new Error(
      image
        ? "A imagem excede o limite da Meta de 5 MB."
        : "O PDF excede o limite da Meta de 100 MB.",
    );
  return image ? "image" : "document";
}
export function mediaPath(
  company: number,
  lead: number,
  user: string,
  requestId: string,
  filename: string,
) {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error("Identificador do anexo inválido.");
  const safe = filename
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(-120);
  return `${company}/${lead}/${user}/${requestId}/${safe}`;
}
export function validateMediaSignature(bytes: Uint8Array, mime: string) {
  const valid =
    mime === "application/pdf"
      ? new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
      : mime === "image/png"
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
        : mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid)
    throw new Error("O conteúdo do arquivo não corresponde ao formato JPG, PNG ou PDF informado.");
}
