/* Notification-only service worker: no caching of authenticated pages or API responses. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
function binding(value) {
 return new Promise((resolve, reject) => {
  const request = indexedDB.open("hub-push", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("settings");
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
   const db = request.result;
   const tx = db.transaction("settings", value === undefined ? "readonly" : "readwrite");
   const r = value === undefined ? tx.objectStore("settings").get("user") : tx.objectStore("settings").put(value, "user");
   let result;
   r.onsuccess = () => { result = r.result; };
   tx.oncomplete = () => { db.close(); resolve(result); };
   tx.onerror = () => { db.close(); reject(tx.error); };
  };
 });
}
self.addEventListener("message", event => {
 if (event.data?.type === "HUB_PUSH_USER") {
  event.waitUntil(binding(String(event.data.userId || "")).then(() => event.ports[0]?.postMessage({ ok: true })));
 }
});
self.addEventListener("push", event => {
 event.waitUntil((async () => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}
  const user = await binding().catch(() => null);
  const own = user && user === data.userId;
  let url = new URL("/dashboard", self.location.origin);
  if (own) {
   try {
    const candidate = new URL(data.url);
    if (candidate.origin === self.location.origin && ["/dashboard", "/conversas", "/filas"].includes(candidate.pathname)) url = candidate;
   } catch {}
  }
  await self.registration.showNotification(own ? String(data.title || "Hub Katsuki") : "Hub Katsuki", {
   body: own ? String(data.body || "Você tem um novo aviso.") : "Entre no Hub para consultar seus avisos.",
   icon: "/push-icon-192.png", badge: "/push-icon-192.png",
   tag: own ? String(data.tag || "hub") : "hub-session", data: { url: url.href }
  });
 })());
});
self.addEventListener("notificationclick", event => {
 event.notification.close();
 event.waitUntil((async () => {
  let url = new URL("/dashboard", self.location.origin);
  try {
   const target = new URL(event.notification.data?.url);
   if (target.origin === self.location.origin && ["/dashboard", "/conversas", "/filas"].includes(target.pathname)) url = target;
  } catch {}
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
   if (new URL(client.url).origin === url.origin && "navigate" in client) {
    await client.navigate(url.href); await client.focus(); return;
   }
  }
  await self.clients.openWindow(url.href);
 })());
});
