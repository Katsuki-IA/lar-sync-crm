export const ORIGINS = new Set(["https://hub.katsuki.com.br", "https://myhub.katsuki.com.br", "https://lar-sync-crm.lovable.app"]);
export function validEndpoint(value: unknown): value is string {
 if (typeof value !== "string" || value.length > 2048) return false;
 try {
  const u = new URL(value);
  return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.hash &&
   (u.hostname === "fcm.googleapis.com" || u.hostname === "updates.push.services.mozilla.com" ||
    u.hostname.endsWith(".push.services.mozilla.com") || u.hostname === "web.push.apple.com" ||
    u.hostname.endsWith(".push.apple.com"));
 } catch { return false; }
}
export function validKeys(p256dh: unknown, auth: unknown) {
 return typeof p256dh === "string" && /^[A-Za-z0-9_-]{87}=?$/.test(p256dh) &&
 typeof auth === "string" && /^[A-Za-z0-9_-]{22}(==)?$/.test(auth);
}
