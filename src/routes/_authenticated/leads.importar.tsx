import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Upload, X, FileText, Check, ArrowLeft, ArrowRight, AlertTriangle, Download as DownloadIcon, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useAllowedEmpresas } from "@/hooks/use-allowed-empresas";
import { useFunnels } from "@/hooks/use-funnels";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatLeadOrigin, resolveLeadOrigin } from "@/lib/lead-origin";

export const Route = createFileRoute("/_authenticated/leads/importar")({
  component: ImportLeadsPage,
});

const MAX_BYTES = 10 * 1024 * 1024;

type SysField =
  | "nome"
  | "telefone"
  | "email"
  | "origem"
  | "estagio"
  | "empreendimento"
  | "responsavel"
  | "tags"
  | "observacoes"
  | "ignore";

const SYS_LABEL: Record<SysField, string> = {
  nome: "Nome *",
  telefone: "Telefone *",
  email: "E-mail",
  origem: "Origem",
  estagio: "Estágio",
  empreendimento: "Empreendimento",
  responsavel: "Responsável",
  tags: "Tag(s)",
  observacoes: "Observações",
  ignore: "(Ignorar esta coluna)",
};
const SYS_ORDER: SysField[] = ["nome", "telefone", "email", "origem", "estagio", "empreendimento", "responsavel", "tags", "observacoes", "ignore"];

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_\-]+/g, "");
}

function guessField(header: string): SysField {
  const n = norm(header);
  if (["nome", "name", "nomecompleto", "cliente"].includes(n)) return "nome";
  if (["fone", "tel", "celular", "whatsapp", "telefone", "phone"].includes(n)) return "telefone";
  if (["email", "mail"].includes(n)) return "email";
  if (["origem", "modulo", "canal", "source", "midia"].includes(n)) return "origem";
  if (["estagio", "stage", "etapa"].includes(n)) return "estagio";
  if (["empreendimento", "produto", "imovel"].includes(n)) return "empreendimento";
  if (["responsavel", "corretor", "assignee"].includes(n)) return "responsavel";
  if (["tag", "tags", "etiqueta"].includes(n)) return "tags";
  if (["obs", "observacao", "anotacao", "notas", "notes"].includes(n)) return "observacoes";
  return "ignore";
}

/* -------- CSV parsing (RFC-ish, handles quotes) -------- */
function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === sep) { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (ch === "\r") { /* skip */ }
      else cur += ch;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim().length));
}

function detectSep(text: string): "," | ";" {
  const sample = parseCsv(text.slice(0, 4096), ",");
  if (sample[0] && sample[0].length > 1) return ",";
  return ";";
}

/* -------- Stepper -------- */
function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const steps = ["Upload", "Mapear colunas", "Confirmar e importar"];
  return (
    <div className="flex items-center gap-3">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = step > n;
        const active = step === n;
        return (
          <div key={label} className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold border",
                  done && "bg-primary text-primary-foreground border-primary",
                  active && "bg-primary/15 text-primary border-primary",
                  !done && !active && "bg-card text-muted-foreground border-border",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : n}
              </div>
              <span className={cn("text-sm", active ? "text-foreground font-medium" : done ? "text-foreground" : "text-muted-foreground")}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && <div className={cn("h-px w-10", done ? "bg-primary" : "bg-border")} />}
          </div>
        );
      })}
    </div>
  );
}

/* -------- Page -------- */
function ImportLeadsPage() {
  const navigate = useNavigate();
  const { data: me } = useCrmUser();
  const { data: allowed } = useAllowedEmpresas();
  const { data: funnels = [] } = useFunnels(me?.id_empresa);

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState<string>("");
  const [sep, setSep] = useState<"," | ";">(",");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (text ? parseCsv(text, sep) : []), [text, sep]);
  const headers = parsed[0] ?? [];
  const dataRows = parsed.slice(1);

  // Step 2
  const [mapping, setMapping] = useState<SysField[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!headers.length) return;
    setMapping(headers.map((h) => guessField(h)));
  }, [headers.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Step 3
  const [skipDup, setSkipDup] = useState(true);
  const [assignMe, setAssignMe] = useState(true);
  const [defaultFunnel, setDefaultFunnel] = useState<string>("");
  const [defaultStage, setDefaultStage] = useState<string>("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ success: number; dup: number; errors: Array<{ row: string[]; motivo: string }> } | null>(null);

  /* meta */
  const { data: meta } = useQuery({
    enabled: !!me && !!allowed,
    queryKey: ["import-meta", me?.id_empresa, allowed],
    queryFn: async () => {
      const { data: defaultFunnel } = await supabase
        .from("crm_funnels").select("id").eq("id_empresa", me!.id_empresa!).eq("is_default", true).maybeSingle();
      const stagesQ = supabase.from("crm_stages").select("id, nome, id_funnel, ordem").eq("ativo", true).order("ordem");
      const [{ data: stages }, { data: emps }, { data: users }, { data: tags }] = await Promise.all([
        stagesQ,
        supabase.from("empreendimento").select("id, nome").in("id_empresa", allowed ?? []),
        supabase.from("crm_users").select("id, nome, email").eq("active", true).in("id_empresa", allowed ?? []),
        supabase.from("crm_tags").select("id, nome").in("id_empresa", allowed ?? []),
      ]);
      return { stages: stages ?? [], emps: emps ?? [], users: users ?? [], tags: tags ?? [], defaultFunnelId: defaultFunnel?.id ?? null };
    },
  });

  useEffect(() => {
    if (!defaultFunnel && funnels.length) {
      const selected = funnels.length === 1
        ? funnels[0]
        : funnels.find((funnel) => funnel.is_default) ?? funnels[0];
      setDefaultFunnel(String(selected.id));
    }
  }, [funnels, defaultFunnel]);

  const selectedFunnelId = defaultFunnel
    ? Number(defaultFunnel)
    : (meta?.defaultFunnelId ?? null);
  const visibleStages = (meta?.stages ?? []).filter((stage) =>
    selectedFunnelId ? stage.id_funnel === selectedFunnelId : true,
  );

  useEffect(() => {
    if (!visibleStages.length) {
      if (defaultStage) setDefaultStage("");
      return;
    }
    if (!defaultStage || !visibleStages.some((stage) => String(stage.id) === defaultStage)) {
      setDefaultStage(String(visibleStages[0].id));
    }
  }, [defaultStage, visibleStages]);

  /* file handling */
  async function loadFile(f: File) {
    setUploadError(null);
    const ext = f.name.toLowerCase().split(".").pop();
    if (ext !== "csv" && ext !== "txt") {
      setUploadError("Formato inválido. Use apenas .csv ou .txt");
      return;
    }
    if (f.size > MAX_BYTES) {
      setUploadError("Arquivo acima de 10MB");
      return;
    }
    const t = await f.text();
    setFile(f);
    setText(t);
    setSep(detectSep(t));
  }

  function clearFile() {
    setFile(null); setText(""); setMapping([]); setUploadError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function setMap(idx: number, v: SysField) {
    setMapping((prev) => {
      const next = [...prev];
      next[idx] = v;
      return next;
    });
    setMapError(null);
  }

  function validateMapping(): string | null {
    if (!mapping.includes("nome")) return "Mapeie a coluna de Nome";
    if (!mapping.includes("telefone")) return "Mapeie a coluna de Telefone";
    return null;
  }

  const usedFields = new Set(mapping.filter((m) => m !== "ignore"));

  /* ===== Import action ===== */
  async function runImport() {
    if (!me?.id_empresa) { toast.error("Empresa não definida"); return; }
    const total = dataRows.length;
    setProgress({ done: 0, total });
    setResult(null);

    const empByName = new Map((meta?.emps ?? []).map((e) => [norm(e.nome), e.id]));
    const stageByName = new Map(visibleStages.map((s) => [norm(s.nome), s.id]));
    const userByKey = new Map<string, string>();
    (meta?.users ?? []).forEach((u) => {
      userByKey.set(norm(u.nome), u.id);
      if (u.email) userByKey.set(norm(u.email), u.id);
    });
    const tagByName = new Map((meta?.tags ?? []).map((t) => [norm(t.nome), t.id]));

    let success = 0;
    let dup = 0;
    const errors: Array<{ row: string[]; motivo: string }> = [];

    for (let i = 0; i < total; i++) {
      const row = dataRows[i];
      try {
        const get = (f: SysField) => {
          const idx = mapping.indexOf(f);
          return idx >= 0 ? (row[idx] ?? "").trim() : "";
        };
        const nome = get("nome");
        const telefoneRaw = get("telefone");
        const telefone = telefoneRaw.replace(/\D/g, "");
        if (!nome) throw new Error("Nome vazio");
        if (!telefone) throw new Error("Telefone vazio");

        const numero = telefone.startsWith("55") ? telefone : `55${telefone}`;

        if (skipDup) {
          const { data: existing } = await supabase
            .from("crm_leads").select("id").eq("id_empresa", me.id_empresa).eq("telefone", numero).limit(1).maybeSingle();
          if (existing) { dup += 1; setProgress({ done: i + 1, total }); continue; }
        }

        const email = get("email") || null;
        const empRaw = get("empreendimento");
        const stageRaw = get("estagio");
        const respRaw = get("responsavel");
        const tagsRaw = get("tags");
        const obs = get("observacoes");
        const origem = resolveLeadOrigin(get("origem"));

        const id_empreendimento = empRaw ? empByName.get(norm(empRaw)) ?? null : null;
        const stageId = stageRaw ? stageByName.get(norm(stageRaw)) ?? null : null;
        const respId = respRaw ? userByKey.get(norm(respRaw)) ?? null : null;
        const assignedTo = me.role === "agent" ? me.id : respId ?? (assignMe ? me.id : null);
        const finalStage = stageId ?? (defaultStage ? Number(defaultStage) : null);

        const insert = {
          id_empresa: me.id_empresa,
          nome,
          telefone: numero,
          email,
          origem,
          id_empreendimento,
          crm_assigned_to: assignedTo,
          crm_stage_id: finalStage,
        };
        const { data: created, error } = await supabase.from("crm_leads").insert(insert).select("id").single();
        if (error) throw error;

        // Tags
        if (tagsRaw) {
          const tagNames = tagsRaw.split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
          const tagIds = tagNames.map((tn) => tagByName.get(norm(tn))).filter((v): v is number => typeof v === "number");
          if (tagIds.length) {
            await supabase.from("crm_lead_tags").insert(tagIds.map((tid) => ({ lead_id: created.id, tag_id: tid })));
          }
        }

        // Activity with origem/obs
        const desc = [`Origem: ${formatLeadOrigin(origem)}`, obs && `Obs: ${obs}`].filter(Boolean).join(" · ");
        await supabase.from("crm_lead_activities").insert({
          lead_id: created.id, crm_user_id: me.id, tipo: "system", descricao: desc,
        });

        success += 1;
      } catch (e) {
        errors.push({ row, motivo: (e as Error).message ?? "Erro desconhecido" });
      }
      setProgress({ done: i + 1, total });
    }

    setResult({ success, dup, errors });
  }

  function downloadErrorReport() {
    if (!result) return;
    const head = [...headers, "motivo_erro"];
    const lines = [head.map(csvEsc).join(",")];
    for (const er of result.errors) lines.push([...er.row.map(csvEsc), csvEsc(er.motivo)].join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "erros_importacao.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  /* ===== UI ===== */
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-foreground">Importar leads</h1>
          <p className="text-sm text-muted-foreground mt-1">Importe leads em lote a partir de um arquivo .csv ou .txt</p>
        </div>
        <Button variant="ghost" onClick={() => navigate({ to: "/leads" })}>Cancelar</Button>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="pt-6 pb-4">
          <Stepper step={step} />
        </CardContent>
      </Card>

      {step === 1 && (
        <Step1
          file={file}
          uploadError={uploadError}
          headers={headers}
          dataRows={dataRows}
          sep={sep}
          setSep={setSep}
          loadFile={loadFile}
          clearFile={clearFile}
          inputRef={inputRef}
          onNext={() => setStep(2)}
          onCancel={() => navigate({ to: "/leads" })}
        />
      )}

      {step === 2 && (
        <Step2
          headers={headers}
          firstRow={dataRows[0] ?? []}
          dataRows={dataRows}
          mapping={mapping}
          setMap={setMap}
          usedFields={usedFields}
          mapError={mapError}
          onBack={() => setStep(1)}
          onNext={() => {
            const e = validateMapping();
            if (e) { setMapError(e); return; }
            setStep(3);
          }}
        />
      )}

      {step === 3 && (
        <Step3
          file={file!}
          sep={sep}
          headers={headers}
          mapping={mapping}
          totalRows={dataRows.length}
          skipDup={skipDup}
          setSkipDup={setSkipDup}
          assignMe={assignMe}
          setAssignMe={setAssignMe}
          defaultStage={defaultStage}
          setDefaultStage={setDefaultStage}
          defaultFunnel={selectedFunnelId ? String(selectedFunnelId) : ""}
          setDefaultFunnel={setDefaultFunnel}
          funnels={funnels}
          stages={visibleStages}
          progress={progress}
          result={result}
          onBack={() => { if (!progress) setStep(2); }}
          onImport={runImport}
          onFinish={() => navigate({ to: "/leads" })}
          onDownloadErrors={downloadErrorReport}
        />
      )}
    </div>
  );
}

/* ===== Step 1 ===== */
function Step1({
  file, uploadError, headers, dataRows, sep, setSep, loadFile, clearFile, inputRef, onNext, onCancel,
}: {
  file: File | null;
  uploadError: string | null;
  headers: string[];
  dataRows: string[][];
  sep: "," | ";";
  setSep: (s: "," | ";") => void;
  loadFile: (f: File) => void;
  clearFile: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onNext: () => void;
  onCancel: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <Card className="rounded-2xl">
      <CardContent className="pt-6 space-y-4">
        {!file ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragOver(false);
              const f = e.dataTransfer.files?.[0]; if (f) loadFile(f);
            }}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors",
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/60",
            )}
          >
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <div className="text-sm font-medium text-foreground">Arraste seu arquivo aqui ou clique para selecionar</div>
            <div className="text-xs text-muted-foreground mt-1">Formatos aceitos: .csv e .txt · Tamanho máximo: 10MB</div>
            <input
              ref={inputRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-xl border border-border bg-card/50 p-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium">{file.name}</div>
                <div className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB · {dataRows.length} linhas</div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={clearFile}>
              <X className="h-4 w-4 mr-1" /> Remover
            </Button>
          </div>
        )}

        {uploadError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {uploadError}
          </div>
        )}

        {file && (
          <>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Separador detectado:</span>
              <button
                onClick={() => setSep(",")}
                className={cn("px-2.5 py-1 rounded-md border", sep === "," ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground")}
              >, Vírgula</button>
              <button
                onClick={() => setSep(";")}
                className={cn("px-2.5 py-1 rounded-md border", sep === ";" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground")}
              >; Ponto e vírgula</button>
            </div>

            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-white/[0.03] text-muted-foreground">
                  <tr>{headers.map((h, i) => (<th key={i} className="text-left px-3 py-2 font-medium whitespace-nowrap">{h || `Coluna ${i + 1}`}</th>))}</tr>
                </thead>
                <tbody>
                  {dataRows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t border-border/40">
                      {headers.map((_h, j) => (<td key={j} className="px-3 py-2 whitespace-nowrap text-foreground/80">{r[j] ?? ""}</td>))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button onClick={onNext} disabled={!file || dataRows.length === 0}>
            Próximo <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ===== Step 2 ===== */
function Step2({
  headers, firstRow, dataRows, mapping, setMap, usedFields, mapError, onBack, onNext,
}: {
  headers: string[];
  firstRow: string[];
  dataRows: string[][];
  mapping: SysField[];
  setMap: (i: number, v: SysField) => void;
  usedFields: Set<SysField>;
  mapError: string | null;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardContent className="pt-6">
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Coluna no arquivo</th>
                  <th className="text-left px-3 py-2 font-medium">Exemplo de valor</th>
                  <th className="text-left px-3 py-2 font-medium w-[260px]">Campo do sistema</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((h, i) => {
                  const value = mapping[i] ?? "ignore";
                  const isUnknown = value === "ignore";
                  return (
                    <tr key={i} className={cn("border-t border-border/40", isUnknown && "bg-amber-500/[0.04]")}>
                      <td className="px-3 py-2 font-medium">{h || `Coluna ${i + 1}`}</td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[280px]">{firstRow[i] ?? ""}</td>
                      <td className="px-3 py-2">
                        <Select value={value} onValueChange={(v) => setMap(i, v as SysField)}>
                          <SelectTrigger className={cn("h-9", isUnknown && "border-amber-500/60")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SYS_ORDER.map((f) => (
                              <SelectItem
                                key={f}
                                value={f}
                                disabled={f !== "ignore" && f !== value && usedFields.has(f)}
                              >
                                {SYS_LABEL[f]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {mapError && (
            <div className="flex items-center gap-2 text-sm text-destructive mt-3">
              <AlertTriangle className="h-4 w-4" /> {mapError}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardContent className="pt-6">
          <div className="text-sm font-semibold mb-3">Prévia dos primeiros registros</div>
          <div className="grid gap-3 md:grid-cols-3">
            {dataRows.slice(0, 3).map((row, i) => (
              <div key={i} className="rounded-xl border border-border bg-card/40 p-3 space-y-1.5">
                {mapping.map((f, idx) => {
                  if (f === "ignore") return null;
                  return (
                    <div key={idx} className="text-xs">
                      <span className="text-muted-foreground">{SYS_LABEL[f].replace(" *", "")}: </span>
                      <span className="text-foreground">{row[idx] ?? ""}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
        <Button onClick={onNext}>Próximo <ArrowRight className="h-4 w-4 ml-1" /></Button>
      </div>
    </div>
  );
}

/* ===== Step 3 ===== */
function Step3({
  file, sep, headers, mapping, totalRows, skipDup, setSkipDup, assignMe, setAssignMe,
  defaultStage, setDefaultStage, defaultFunnel, setDefaultFunnel, funnels, stages, progress, result,
  onBack, onImport, onFinish, onDownloadErrors,
}: {
  file: File;
  sep: "," | ";";
  headers: string[];
  mapping: SysField[];
  totalRows: number;
  skipDup: boolean; setSkipDup: (b: boolean) => void;
  assignMe: boolean; setAssignMe: (b: boolean) => void;
  defaultStage: string; setDefaultStage: (s: string) => void;
  defaultFunnel: string; setDefaultFunnel: (s: string) => void;
  funnels: Array<{ id: number; nome: string; is_default: boolean }>;
  stages: Array<{ id: number; nome: string }>;
  progress: { done: number; total: number } | null;
  result: { success: number; dup: number; errors: Array<{ row: string[]; motivo: string }> } | null;
  onBack: () => void;
  onImport: () => void;
  onFinish: () => void;
  onDownloadErrors: () => void;
}) {
  if (result) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="pt-8 pb-6 text-center space-y-4">
          <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-400" />
          <div className="space-y-1">
            <div className="text-lg font-semibold">Importação concluída</div>
            <div className="text-sm text-emerald-400">✅ {result.success} leads importados com sucesso</div>
            {result.dup > 0 && <div className="text-sm text-amber-400">⚠️ {result.dup} linhas ignoradas por duplicidade de telefone</div>}
            {result.errors.length > 0 && (
              <div className="text-sm text-rose-400 flex items-center justify-center gap-2">
                ❌ {result.errors.length} linhas com erro
                <Button size="sm" variant="outline" onClick={onDownloadErrors}>
                  <DownloadIcon className="h-3.5 w-3.5 mr-1" /> Baixar relatório (.csv)
                </Button>
              </div>
            )}
          </div>
          <div className="flex justify-center pt-2">
            <Button onClick={onFinish}>Ir para lista de leads</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const sepLabel = sep === "," ? "vírgula" : "ponto e vírgula";
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;

  return (
    <Card className="rounded-2xl">
      <CardContent className="pt-6 space-y-5">
        <div>
          <div className="text-lg font-semibold">{totalRows} leads serão importados</div>
          <div className="text-xs text-muted-foreground mt-1">Arquivo: {file.name} · Separador: {sepLabel}</div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Mapeamento</div>
          <div className="grid gap-1 sm:grid-cols-2">
            {mapping.map((f, i) => f !== "ignore" && (
              <div key={i} className="text-xs flex justify-between gap-2 rounded-md bg-card/40 border border-border px-2 py-1.5">
                <span className="text-muted-foreground truncate">{headers[i] || `Coluna ${i + 1}`}</span>
                <span className="text-foreground font-medium">→ {SYS_LABEL[f].replace(" *", "")}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={skipDup} onCheckedChange={(v) => setSkipDup(!!v)} />
            Ignorar linhas com telefone já cadastrado no sistema
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={assignMe} onCheckedChange={(v) => setAssignMe(!!v)} />
            Atribuir para mim se responsável não estiver mapeado
          </label>
          {funnels.length > 1 ? (
            <div className="space-y-1.5 max-w-sm">
              <Label className="text-sm">Funil padrão para leads importados</Label>
              <Select value={defaultFunnel} onValueChange={(value) => {
                setDefaultFunnel(value);
                setDefaultStage("");
              }}>
                <SelectTrigger><SelectValue placeholder="Selecione um funil" /></SelectTrigger>
                <SelectContent>
                  {funnels.map((funnel) => (
                    <SelectItem key={funnel.id} value={String(funnel.id)}>
                      {funnel.nome}
                      {funnel.is_default ? " (padrão)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5 max-w-sm">
            <Label className="text-sm">Estágio padrão para leads sem estágio mapeado</Label>
            <Select value={defaultStage} onValueChange={setDefaultStage}>
              <SelectTrigger><SelectValue placeholder="Selecione um estágio" /></SelectTrigger>
              <SelectContent>
                {stages.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {progress && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Importando…</span>
              <span className="text-foreground">{progress.done} de {progress.total} processados</span>
            </div>
            <div className="h-2 w-full rounded-full bg-border overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack} disabled={!!progress}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <Button onClick={onImport} disabled={!!progress}>
            {progress ? `Importando… (${progress.done}/${progress.total})` : `Importar ${totalRows} leads`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function csvEsc(v: string) {
  if (/[",\n;]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
