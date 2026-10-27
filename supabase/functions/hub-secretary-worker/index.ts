import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { createSecretaryWorker } from "../_shared/secretary-worker.ts";

Deno.serve(async (req: Request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return new Response(null, { status: 503 });
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error("Database operation failed");
    return data;
  };
  return createSecretaryWorker({
    load: (token) => rpc("hub_secretary_runtime", { p_kind: "worker", p_token: token }),
    call: (token, operation, args) =>
      rpc("hub_secretary_call", {
        p_kind: "worker",
        p_token: token,
        p_operation: operation,
        p_args: args,
      }),
  })(req);
});
