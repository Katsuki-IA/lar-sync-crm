import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RelatorioAtendimento,
  type RelatorioLinha,
} from "@/components/relatorio-ia/relatorio-atendimento";

export const Route = createFileRoute("/_authenticated/relatorio-ia")({
  head: () => ({
    meta: [
      { title: "Relatório IA | Hub Katsuki.IA" },
      { name: "description", content: "Raio-X do atendimento da IA da sua empresa." },
      { property: "og:title", content: "Relatório IA | Hub Katsuki.IA" },
      { property: "og:description", content: "Raio-X do atendimento da IA da sua empresa." },
    ],
  }),
  component: RelatorioIaPage,
});

const FN_URL = "https://ksseilysiypcpartnari.supabase.co/functions/v1/relatorio-atendimento-hub";

class RelatorioError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function chamar<T>(query: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const res = await fetch(FN_URL + query, { headers: { Authorization: "Bearer " + token } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new RelatorioError(res.status, body?.erro ?? "Erro ao carregar relatório.");
  return body as T;
}

function RelatorioIaPage() {
  const { data: me, isLoading: loadingMe } = useCrmUser();
  const isSuper = me?.role === "super_admin";
  const [empresa, setEmpresa] = useState<string>("");

  const lista = useQuery({
    queryKey: ["relatorio-ia-lista"],
    queryFn: () => chamar<{ id_empresa: number; nome: string | null }[]>("?lista=1"),
    enabled: isSuper,
  });

  useEffect(() => {
    if (isSuper && !empresa && lista.data?.length) setEmpresa(String(lista.data[0].id_empresa));
  }, [isSuper, empresa, lista.data]);

  const relatorio = useQuery({
    queryKey: ["relatorio-ia", isSuper ? empresa : "self"],
    queryFn: () =>
      chamar<{ cliente: RelatorioLinha; carteira: RelatorioLinha | null }>(
        isSuper ? `?id_empresa=${empresa}` : "",
      ),
    enabled: !!me && (!isSuper || !!empresa),
    retry: false,
  });

  const err = relatorio.error as RelatorioError | null;
  const msg = err
    ? err.status === 401 || err.status === 403
      ? "Sem acesso ao relatório."
      : err.status === 404
        ? "Relatório ainda não disponível para esta empresa"
        : err.message
    : null;

  return (
    <div className="space-y-4">
      {isSuper && (
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Cliente</span>
          <Select value={empresa} onValueChange={setEmpresa}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Selecione o cliente" />
            </SelectTrigger>
            <SelectContent>
              {(lista.data ?? []).map((e) => (
                <SelectItem key={e.id_empresa} value={String(e.id_empresa)}>
                  {e.nome ?? `Empresa ${e.id_empresa}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {loadingMe || relatorio.isLoading ? (
        <p className="py-20 text-center text-sm text-muted-foreground">Carregando relatório…</p>
      ) : msg ? (
        <p className="py-20 text-center text-sm text-muted-foreground">{msg}</p>
      ) : relatorio.data ? (
        <RelatorioAtendimento cliente={relatorio.data.cliente} carteira={relatorio.data.carteira} />
      ) : null}
    </div>
  );
}
