import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCrmUser } from "@/hooks/use-crm-user";
import { pushApi, isHomeScreenRequired, isStandalone, bindPushUser, disableDevicePush, decodeApplicationKey } from "@/lib/web-push";

export function PushNotificationSettings() {
 const { data: me } = useCrmUser();
 const [state, setState] = useState<"loading" | "unsupported" | "install" | "blocked" | "off" | "on" | "error">("loading");
 const [busy, setBusy] = useState(false);
 useEffect(() => {
  let live = true;
  (async () => {
   if (!window.isSecureContext) return "unsupported";
   if (isHomeScreenRequired() && !isStandalone()) return "install";
   if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
   if (Notification.permission === "denied") return "blocked";
   const reg = await navigator.serviceWorker.getRegistration("/");
   const sub = await reg?.pushManager?.getSubscription();
   if (!sub || !me?.active) return "off";
   const status = await pushApi("status", { endpoint: sub.endpoint });
   if (status.enabled && reg) { await bindPushUser(reg, me.id); return "on"; }
   return "off";
  })().then(s => { if (live) setState(s as typeof state); }).catch(() => { if (live) setState("error"); });
  return () => { live = false; };
 }, [me?.id, me?.active]);
 async function enable() {
  setBusy(true);
  try {
   // Must be called directly from the tap, before network calls (iOS requirement).
   const permission = await Notification.requestPermission();
   if (permission !== "granted") { setState(permission === "denied" ? "blocked" : "off"); return; }
   await navigator.serviceWorker.register("/hub-push-sw.js", { scope: "/", updateViaCache: "none" });
   const reg = await navigator.serviceWorker.ready;
   const { publicKey } = await pushApi("config");
   let sub = await reg.pushManager.getSubscription();
   if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeApplicationKey(publicKey) });
   const keys = sub.toJSON().keys!;
   await pushApi("register", { endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth });
   await bindPushUser(reg, me!.id);
   setState("on"); toast.success("Notificações ativadas neste aparelho");
  } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
 }
 async function disable() {
  setBusy(true);
  try {
   await disableDevicePush();
   setState("off");
  } catch(e) { toast.error((e as Error).message); } finally { setBusy(false); }
 }
 if (!me?.active) return null;
 return <section className="space-y-2 border-b p-3" aria-label="Notificações no celular">
  <p className="text-sm font-medium">Notificações neste aparelho</p>
  <p className="text-xs text-muted-foreground">
   {state === "install" ? "No iPhone/iPad, abra no Safari, toque em Compartilhar → Adicionar à Tela de Início. Abra pelo ícone e volte aqui para ativar."
    : state === "unsupported" ? "Este navegador não oferece notificações. Tente um navegador atualizado."
    : state === "blocked" ? "Notificações bloqueadas. Libere nas configurações do navegador ou do aparelho e abra o Hub novamente."
    : state === "on" ? "Ativas para seus atendimentos, ofertas de leads e avisos, mesmo com o Hub fechado. Válidas nas empresas às quais você tem acesso."
    : state === "loading" ? "Verificando este aparelho…"
    : "Receba avisos mesmo com o Hub fechado. A ativação vale apenas para este aparelho."}
  </p>
  {["off", "error"].includes(state) && <Button size="sm" disabled={busy} onClick={enable}>Ativar notificações</Button>}
  {state === "on" && <div className="flex flex-wrap gap-2">
   <Button size="sm" variant="ghost" disabled={busy} onClick={disable}>Desativar</Button>
  </div>}
 </section>;
}
