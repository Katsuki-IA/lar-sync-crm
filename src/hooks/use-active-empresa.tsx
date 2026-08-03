import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { useCrmUser } from "@/hooks/use-crm-user";

type Empresa = { id: number; nome: string | null };

type ActiveEmpresaContextValue = {
  activeEmpresaId: number | null;
  activeEmpresa: Empresa | null;
  empresas: Empresa[];
  isLoading: boolean;
  requiresSelection: boolean;
  isSuperAdmin: boolean;
  setActiveEmpresaId: (id: number) => void;
};

const ActiveEmpresaContext = createContext<ActiveEmpresaContextValue | null>(null);
const storageKey = "crm.active-empresa.v1";

function getStoredEmpresaId(userId?: string) {
  if (typeof window === "undefined" || !userId) return null;
  const value = window.localStorage.getItem(`${storageKey}.${userId}`);
  const id = value ? Number(value) : NaN;
  return Number.isFinite(id) ? id : null;
}

export function ActiveEmpresaProvider({ children }: { children: ReactNode }) {
  const { data: me } = useCrmUser();
  const { data: allowed, isLoading: loadingAllowed } = useAllowedEmpresas();
  const isSuperAdmin = me?.role === "super_admin";
  const [activeEmpresaId, setActiveEmpresaIdState] = useState<number | null>(null);

  const { data: empresas = [], isLoading: loadingEmpresas } = useQuery({
    enabled: !!me && (isSuperAdmin || !!allowed?.length),
    queryKey: ["active-empresa-options", me?.role, allowed],
    queryFn: async (): Promise<Empresa[]> => {
      let query = supabase
        .from("empresa_dados")
        .select("id,nome")
        .order("nome");
      if (!isSuperAdmin) query = query.in("id", allowed ?? []);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Empresa[];
    },
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!me || (!isSuperAdmin && !allowed)) return;

    if (!isSuperAdmin) {
      setActiveEmpresaIdState(me.id_empresa ?? null);
      return;
    }

    const storedId = getStoredEmpresaId(me.id);
    setActiveEmpresaIdState((current) => {
      if (current && empresas.some((empresa) => empresa.id === current)) return current;
      if (storedId && empresas.some((empresa) => empresa.id === storedId)) return storedId;
      return null;
    });
  }, [allowed, empresas, isSuperAdmin, me]);

  const setActiveEmpresaId = useCallback((id: number) => {
    if (!empresas.some((empresa) => empresa.id === id)) return;
    setActiveEmpresaIdState(id);
    if (typeof window !== "undefined" && me?.id) {
      window.localStorage.setItem(`${storageKey}.${me.id}`, String(id));
    }
  }, [empresas, me?.id]);

  const value = useMemo<ActiveEmpresaContextValue>(() => ({
    activeEmpresaId,
    activeEmpresa: empresas.find((empresa) => empresa.id === activeEmpresaId) ?? null,
    empresas,
    isLoading: loadingAllowed || loadingEmpresas,
    requiresSelection: Boolean(isSuperAdmin && !activeEmpresaId && !loadingAllowed && !loadingEmpresas && empresas.length),
    isSuperAdmin: Boolean(isSuperAdmin),
    setActiveEmpresaId,
  }), [activeEmpresaId, empresas, isSuperAdmin, loadingAllowed, loadingEmpresas, setActiveEmpresaId]);

  return <ActiveEmpresaContext.Provider value={value}>{children}</ActiveEmpresaContext.Provider>;
}

export function useActiveEmpresa() {
  const context = useContext(ActiveEmpresaContext);
  if (!context) throw new Error("useActiveEmpresa deve ser usado dentro de ActiveEmpresaProvider");
  return context;
}
