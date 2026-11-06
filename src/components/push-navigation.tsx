import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { pendingPushKey, rememberPushLocation, disableDevicePush, bindPushUser, pushApi } from "@/lib/web-push";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";

export function PushNavigation() {
 const { data: me } = useCrmUser();
 const { empresas, isLoading, activeEmpresaId, setActiveEmpresaId } = useActiveEmpresa();
 const navigate = useNavigate();
 const href = useRouterState({ select: s => s.location.href });
 useEffect(() => {
  if (!me || !("serviceWorker" in navigator)) return;
  let live = true;
  void (async () => {
   const reg = await navigator.serviceWorker.getRegistration("/");
   const sub = await reg?.pushManager?.getSubscription();
   if (!reg || !sub || !live) return;
   await bindPushUser(reg, "");
   if (!me.active) { await disableDevicePush(); return; }
   const status = await pushApi("status", { endpoint: sub.endpoint });
   if (!live) return;
   if (status.enabled) await bindPushUser(reg, me.id);
   else await disableDevicePush();
  })().catch(() => {});
  return () => { live = false; };
 }, [me?.id, me?.active]);
 useEffect(() => {
  const { data } = supabase.auth.onAuthStateChange(event => {
   if (event === "SIGNED_OUT") setTimeout(() => { void disableDevicePush().catch(() => {}); }, 0);
  });
  return () => data.subscription.unsubscribe();
 }, []);
 useEffect(() => {
  rememberPushLocation();
  const saved = sessionStorage.getItem(pendingPushKey);
  if (!saved || isLoading) return;
  const url = new URL(saved, window.location.origin);
  const company = Number(url.searchParams.get("push_company"));
  if (!empresas.some(e => e.id === company)) {
   sessionStorage.removeItem(pendingPushKey); return;
  }
  if (activeEmpresaId !== company) { setActiveEmpresaId(company); return; }
  sessionStorage.removeItem(pendingPushKey);
  const lead = url.searchParams.get("lead") || "";
  if (url.pathname === "/conversas" && /^\d+$/.test(lead)) {
   void navigate({ to: "/conversas", search: { lead }, replace: true });
  } else if (url.pathname === "/filas") void navigate({ to: "/filas", replace: true });
 }, [href, empresas, isLoading, activeEmpresaId, setActiveEmpresaId, navigate]);
 return null;
}
