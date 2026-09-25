import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  empresaId: z.number().int().positive(),
  empreendimentoId: z.number().int().positive().nullable(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type LeadReportRow = {
  id: number;
  idExterno: string | null;
  nome: string | null;
  numero: string | null;
  createdAt: string;
  empreendimentoId: number | null;
  empreendimento: string | null;
  estado: string;
  interacoes: number;
  qualificado: number;
  visita: "registrada" | "cancelada" | "sem";
  visitaDatas: string[];
  humano: boolean;
  bloqueado: boolean;
  telefoneValido: boolean;
  motivoBloqueio: string | null;
  followups: string[];
  perdido: boolean;
};

function digits(v: string | null | undefined) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}
const validPhone = (d: string) => /^55\d{10,11}$/.test(d) || /^[1-9]\d{9,14}$/.test(d);

function parseHistory(v: string | null): string[] {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p.map(String) : [String(p)];
  } catch {
    return v.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  }
}

// Walk Supabase pages so results are never truncated at 1000 rows.
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}
function chunks<T>(arr: T[], size = 300) {
  const r: T[][] = [];
  for (let i = 0; i < arr.length; i += size) r.push(arr.slice(i, i + size));
  return r;
}

export const getLeadReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: me, error: meErr } = await context.supabase
      .from("crm_users")
      .select("role,active,id_empresa")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (meErr || !me || me.active !== true || !["manager", "analyst", "super_admin"].includes(me.role))
      throw new Error("Acesso negado");
    const { data: allowed, error: aErr } = await context.supabase.rpc("crm_get_allowed_empresas");
    if (aErr) throw new Error(aErr.message);
    const allowedIds = ((allowed ?? []) as unknown[]).map(Number);
    if (!allowedIds.includes(data.empresaId)) throw new Error("Empresa não autorizada");
    if (me.role === "manager" && me.id_empresa !== data.empresaId) throw new Error("Empresa não autorizada");
    if (data.from > data.to) throw new Error("Período inválido");

    const start = new Date(`${data.from}T00:00:00-03:00`).toISOString();
    const end = new Date(new Date(`${data.to}T00:00:00-03:00`).getTime() + 86_400_000).toISOString();

    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const leads = await fetchAll((f, t) => {
      let q = db
        .from("lead")
        .select("id,id_crm,nome,numero,created_at,id_empreendimento,status,crm_stage_id,qtd_interacoes,atendimento_humano,qualificado,status_history")
        .eq("id_empresa", data.empresaId)
        .gte("created_at", start)
        .lt("created_at", end)
        .order("id", { ascending: false });
      if (data.empreendimentoId) q = q.eq("id_empreendimento", data.empreendimentoId);
      return q.range(f, t);
    });
    const ids = leads.map((l) => l.id);

    const [emps, stages, blocked] = await Promise.all([
      fetchAll((f, t) => db.from("empreendimento").select("id,nome").eq("id_empresa", data.empresaId).order("id").range(f, t)),
      fetchAll((f, t) => db.from("crm_stages").select("id,nome").eq("id_empresa", data.empresaId).order("id").range(f, t)),
      fetchAll((f, t) => db.from("blocked_numbers").select("numero,motivo_bloqueio").eq("id_empresa", data.empresaId).order("id").range(f, t)),
    ]);

    const appts: { id_lead: number | null; day: string | null; deleted_at: string | null }[] = [];
    const disp: { lead_id: number | null; step_id: number | null; status: string | null; sent_to_meta_at: string | null }[] = [];
    for (const part of chunks(ids)) {
      appts.push(...(await fetchAll((f, t) => db.from("agendamento").select("id_lead,day,deleted_at").in("id_lead", part).order("id").range(f, t))));
      disp.push(
        ...(await fetchAll((f, t) =>
          db.from("followup_dispatches_v2").select("lead_id,step_id,status,sent_to_meta_at")
            .in("lead_id", part).eq("dry_run", false)
            .or("sent_to_meta_at.not.is.null,status.in.(delivered,read)")
            .order("id").range(f, t),
        )),
      );
    }
    const stepIds = [...new Set(disp.map((d) => d.step_id).filter((v): v is number => v != null))];
    const steps = stepIds.length
      ? (await db.from("followup_steps_v2").select("id,nome,step_order").in("id", stepIds)).data ?? []
      : [];
    const stepName = new Map(steps.map((s) => [s.id, s.nome || `Etapa ${s.step_order}`]));

    const empName = new Map(emps.map((e) => [e.id, e.nome]));
    const stageName = new Map(stages.map((s) => [s.id, s.nome]));
    const blockedBy = new Map(blocked.map((b) => [digits(b.numero), b.motivo_bloqueio]));
    const apptBy = new Map<number, typeof appts>();
    for (const a of appts) if (a.id_lead != null) apptBy.set(a.id_lead, [...(apptBy.get(a.id_lead) ?? []), a]);
    const fupBy = new Map<number, Set<string>>();
    for (const d of disp) {
      if (d.lead_id == null) continue;
      const s = fupBy.get(d.lead_id) ?? new Set<string>();
      s.add(stepName.get(d.step_id ?? -1) ?? `Step ${d.step_id}`);
      fupBy.set(d.lead_id, s);
    }

    const rows: LeadReportRow[] = leads.map((l) => {
      const hist = parseHistory(l.status_history);
      const phone = digits(l.numero);
      const telefoneValido = validPhone(phone);
      const bloqueioIa = hist.some((h) => /bloqueio ia/i.test(h));
      const inList = blockedBy.has(phone);
      const motivos = [
        inList ? `Lista de bloqueio${blockedBy.get(phone) ? `: ${blockedBy.get(phone)}` : ""}` : null,
        bloqueioIa ? "Tag Bloqueio IA" : null,
        !telefoneValido ? "Telefone inválido" : null,
      ].filter(Boolean);
      const la = apptBy.get(l.id) ?? [];
      const active = la.filter((a) => !a.deleted_at);
      const fups = new Set(fupBy.get(l.id) ?? []);
      for (const h of hist) if (/^fup\s*\d+/i.test(h)) fups.add(h.toUpperCase().replace(/\s/g, ""));
      const estado = (l.crm_stage_id && stageName.get(l.crm_stage_id)) || l.status || "—";
      return {
        id: l.id,
        idExterno: l.id_crm,
        nome: l.nome,
        numero: l.numero,
        createdAt: l.created_at ?? "",
        empreendimentoId: l.id_empreendimento,
        empreendimento: l.id_empreendimento ? empName.get(l.id_empreendimento) ?? `#${l.id_empreendimento}` : null,
        estado,
        interacoes: l.qtd_interacoes ?? 0,
        qualificado: l.qualificado ?? 0,
        visita: active.length ? "registrada" : la.length ? "cancelada" : "sem",
        visitaDatas: active.map((a) => a.day ?? "").filter(Boolean),
        humano: !!l.atendimento_humano,
        bloqueado: inList || bloqueioIa,
        telefoneValido,
        motivoBloqueio: motivos.join("; ") || null,
        followups: [...fups].sort(),
        perdido: /perdido/i.test(estado) || hist.some((h) => /^perdido$/i.test(h)),
      };
    });

    return { rows, empreendimentos: emps.map((e) => ({ id: e.id, nome: e.nome })) };
  });
