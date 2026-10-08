type AttributionSource = {
  capture_type?: string | null;
  meta_form_id?: string | null;
  utm_source?: string | null;
  source_type?: string | null;
};

export function getAttributionSource(attribution: AttributionSource | null | undefined, origin: string) {
  if (attribution?.capture_type === "ctwa") return "Click to WhatsApp";
  if (origin === "Meta Ads") {
    return attribution?.meta_form_id?.trim() ? "Meta Lead Ads" : "Meta Ads";
  }
  return attribution?.utm_source || attribution?.source_type || "Não identificada";
}
