import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Transcript } from "@/hml/conversations";
import {nativeHistoryMessages,type NativeHistory} from './native-public-history';

export function LegacyHistory({ token, client }: { token: string; client: SupabaseClient }) {
  const [input, setInput] = useState("");
  const [code, setCode] = useState("");
  const query = useQuery({
    queryKey: ["native-public-history", token, code],
    enabled: /^[0-9]{4}$/.test(code),
    retry: false,
    gcTime: 0,
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
    queryFn: async (): Promise<NativeHistory | null> => {
      const { data, error } = await client.rpc("hub_release_public_history", {
        p_lead_ref: token, p_codigo: code,
      });
      if (error) throw error;
      return data as NativeHistory | null;
    },
  });
  // A later denied/error response must hide all previously loaded pages.
  const valid = !!code && !query.isError && !!query.data;
  const messages = valid ? nativeHistoryMessages(query.data!) : [];
  return (
    <section className="space-y-4 rounded-xl border bg-background p-6">
      <h2 className="font-semibold">Histórico com código da empresa</h2>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
        event.preventDefault();
        if (input === code) void query.refetch();
        else setCode(input);
      }}>
        <label className="text-sm">
          Código de acesso
          <input aria-label="Código de acesso" type="password" inputMode="numeric" autoComplete="off"
            maxLength={4} value={input}
            onChange={(event) => { setInput(event.target.value.replace(/[^0-9]/g, "")); setCode(""); }}
            className="mt-1 block w-40 rounded-md border bg-background px-3 py-2" />
        </label>
        <Button type="submit" disabled={input.length !== 4 || query.isFetching}>Acessar histórico</Button>
      </form>
      {!!code && query.isFetching && <p role="status">Carregando histórico…</p>}
      {!!code && (query.isError || (!query.isPending && !valid)) && (
        <p role="alert">Histórico indisponível. Confira o link e o código da empresa.</p>
      )}
      {valid && <>
        <h3 className="font-semibold">{query.data!.lead.nome}</h3>
        {!messages.length ? <p>Nenhuma mensagem disponível.</p> : <Transcript messages={messages} />}
      </>}
    </section>
  );
}

