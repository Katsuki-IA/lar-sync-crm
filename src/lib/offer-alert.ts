import type { SalesOffer } from "./sales-queue";

export function pendingOwnOffers(offers: SalesOffer[], memberId: string, now: number) {
  return offers
    .filter(
      (offer) =>
        offer.member_id === memberId &&
        offer.status === "pending" &&
        Date.parse(offer.expires_at) > now,
    )
    .sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at));
}

export function offerCountdown(expiresAt: string, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000) || 0);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
