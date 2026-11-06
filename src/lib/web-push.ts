import { supabase } from "@/integrations/supabase/client";
export async function pushApi(action: string, values: Record<string, unknown> = {}) {
 const { data, error } = await supabase.functions.invoke("hub-web-push", { body: { action, ...values } });
 if (error || data?.error) throw new Error(data?.error || "Não foi possível configurar as notificações. Tente novamente.");
 return data;
}
export function isHomeScreenRequired() {
 return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
export function isStandalone() {
 return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}
export async function bindPushUser(reg: ServiceWorkerRegistration, userId: string) {
 const worker = reg.active;
 if (!worker) throw new Error("Aguarde um instante e tente novamente.");
 await new Promise<void>((resolve, reject) => {
  const channel = new MessageChannel();
  const timer = setTimeout(() => reject(new Error("Não foi possível ativar neste aparelho.")), 5000);
  channel.port1.onmessage = () => { clearTimeout(timer); channel.port1.close(); resolve(); };
  worker.postMessage({ type: "HUB_PUSH_USER", userId }, [channel.port2]);
 });
}
export async function disableDevicePush() {
 if (!("serviceWorker" in navigator)) return;
 const reg = await navigator.serviceWorker.getRegistration("/");
 const sub = await reg?.pushManager?.getSubscription();
 if (reg) await bindPushUser(reg, "").catch(() => {});
 if (sub) {
  let failure: unknown;
  try { await pushApi("unregister", { endpoint: sub.endpoint }); } catch (e) { failure = e; }
  const removed = await sub.unsubscribe();
  if (failure && !removed) throw failure;
 }
}
export function decodeApplicationKey(value: string): Uint8Array<ArrayBuffer> {
 const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
 return Uint8Array.from(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)), c => c.charCodeAt(0));
}
export const pendingPushKey = "hub.pending-push";
export function rememberPushLocation() {
 if (typeof window === "undefined") return;
 const url = new URL(window.location.href);
 if (["/conversas", "/filas"].includes(url.pathname) && /^\d+$/.test(url.searchParams.get("push_company") || "")) {
  sessionStorage.setItem(pendingPushKey, url.pathname + url.search);
 }
}
