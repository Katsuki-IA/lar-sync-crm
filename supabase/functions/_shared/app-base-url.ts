// Keep historical production configuration compatible with the new Hub domain.
// Other origins (including homologation) remain configurable through APP_BASE_URL.
export function resolveAppBaseUrl(configured?: string | null): string {
  const base = (configured?.trim() || "https://myhub.katsuki.com.br").replace(/\/+$/, "");
  return base.replace(/^https?:\/\/hub\.katsuki\.com\.br(?=\/|$)/i, "https://myhub.katsuki.com.br");
}
