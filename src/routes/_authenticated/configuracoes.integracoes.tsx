import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, ChevronLeft, Facebook, Plug, RefreshCw, Search, Unplug } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  createMetaTestLead,
  createMetaOAuthUrl,
  disconnectMetaConnection,
  exchangeMetaCode,
  type MetaFormsSyncResult,
  getMetaFormFields,
  getMetaIntegrationStatus,
  saveMetaFieldMapping,
  syncMetaForms,
} from "@/lib/meta-oauth.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/configuracoes/integracoes")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: me } = await supabase
      .from("crm_users")
      .select("role")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();
    if (!me || (me.role !== "manager" && me.role !== "super_admin")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: IntegracoesPage,
});

type MetaConnection = {
  id: string;
  user_name: string | null;
  user_id_meta: string;
  connected_at: string | null;
  active: boolean | null;
};

type MetaForm = {
  id: string;
  form_id: string;
  form_name: string | null;
  page_id: string;
  page_name: string | null;
  leads_count: number | null;
  active: boolean | null;
  id_empreendimento: number | null;
  mapped_fields_count?: number;
};

type MetaOAuthCallbackMessage = {
  source?: string;
  ok?: boolean;
  code?: string | null;
  state?: string | null;
  error?: string | null;
  errorDescription?: string | null;
};

type MetaDrawerView = "account" | "pages" | "forms" | "mapping";

type MetaPageSummary = {
  pageId: string;
  pageName: string | null;
  formsCount: number;
  source: string | null;
};

type DisconnectMetaButtonProps = {
  className?: string;
  onDisconnected: () => void;
  variant?: "outline" | "destructive";
};

const CRM_FIELD_OPTIONS = [
  { value: "__ignore__", label: "Ignorar" },
  { value: "nome", label: "Nome" },
  { value: "telefone", label: "Telefone" },
  { value: "email", label: "Email" },
  { value: "origem", label: "Origem" },
  { value: "observacoes", label: "Observações" },
];

const TEST_VALUE_PLACEHOLDERS: Record<string, string> = {
  nome: "Maria Teste",
  telefone: "11999998888",
  email: "maria.teste@email.com",
  origem: "Facebook Lead Ads",
  observacoes: "Lead criado pelo simulador",
};

function getSupabaseOrigin() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).origin;
  } catch {
    return null;
  }
}

function IntegracoesPage() {
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<MetaFormsSyncResult | null>(null);
  const [drawerView, setDrawerView] = useState<MetaDrawerView>("account");
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [pageSearch, setPageSearch] = useState("");
  const [formSearch, setFormSearch] = useState("");
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [selectedEmpreendimentoId, setSelectedEmpreendimentoId] = useState("");
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [savingMapping, setSavingMapping] = useState(false);
  const [creatingTestLead, setCreatingTestLead] = useState(false);

  useEffect(() => {
    const supabaseOrigin = getSupabaseOrigin();
    const handler = async (ev: MessageEvent) => {
      const msg = ev.data as MetaOAuthCallbackMessage | undefined;
      if (!msg) return;

      if (msg.source === "meta-oauth") {
        if (ev.origin !== window.location.origin) return;
        setConnecting(false);
        if (msg.ok) {
          toast.success("Conta Meta conectada com sucesso");
          qc.invalidateQueries({ queryKey: ["meta-integration-status"] });
        } else {
          toast.error(msg.error ?? "Falha ao conectar com o Meta");
        }
        return;
      }

      if (msg.source !== "meta-oauth-callback") return;
      if (supabaseOrigin && ev.origin !== supabaseOrigin) return;

      if (msg.error) {
        setConnecting(false);
        toast.error(msg.errorDescription ?? msg.error);
        return;
      }

      if (!msg.code || !msg.state) {
        setConnecting(false);
        toast.error("Retorno do Meta incompleto");
        return;
      }

      try {
        await exchangeMetaCode({ code: msg.code, state: msg.state });
        toast.success("Conta Meta conectada com sucesso");
        await qc.invalidateQueries({ queryKey: ["meta-integration-status"] });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Falha ao conectar com o Meta");
      } finally {
        setConnecting(false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [qc]);

  const startMetaOAuth = async () => {
    const w = 560;
    const h = 720;
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    const popup = window.open(
      "",
      "meta-oauth",
      `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes,status=no,toolbar=no,menubar=no,location=no`,
    );

    if (!popup) {
      toast.error("Permita popups para conectar com o Facebook");
      return;
    }

    try {
      setConnecting(true);
      popup.document.title = "Conectando Meta";
      const { url } = await createMetaOAuthUrl();
      popup.location.href = url;
    } catch (error) {
      popup.close();
      setConnecting(false);
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar conexão Meta");
    }
  };

  const { data: status, isLoading } = useQuery({
    queryKey: ["meta-integration-status"],
    queryFn: async () => {
      return getMetaIntegrationStatus();
    },
  });

  const connection = (status?.connection as MetaConnection | null | undefined) ?? null;
  const forms = (status?.forms as MetaForm[] | undefined) ?? [];

  const connected = !!connection;
  const pages = useMemo<MetaPageSummary[]>(() => {
    const byId = new Map<string, MetaPageSummary>();

    for (const form of forms) {
      const current = byId.get(form.page_id);
      byId.set(form.page_id, {
        pageId: form.page_id,
        pageName: form.page_name ?? current?.pageName ?? null,
        formsCount: (current?.formsCount ?? 0) + 1,
        source: current?.source ?? null,
      });
    }

    for (const page of lastSync?.pages ?? []) {
      const current = byId.get(page.pageId);
      byId.set(page.pageId, {
        pageId: page.pageId,
        pageName: page.pageName ?? current?.pageName ?? null,
        formsCount: Math.max(page.formsCount, current?.formsCount ?? 0),
        source: page.source ?? current?.source ?? null,
      });
    }

    return Array.from(byId.values())
      .filter((page) => page.formsCount > 0)
      .sort((a, b) =>
        (a.pageName ?? a.pageId).localeCompare(b.pageName ?? b.pageId),
      );
  }, [forms, lastSync]);

  const filteredPages = pages.filter((page) => {
    const term = pageSearch.trim().toLowerCase();
    if (!term) return true;
    return `${page.pageName ?? ""} ${page.pageId}`.toLowerCase().includes(term);
  });

  const selectedPage = pages.find((page) => page.pageId === selectedPageId) ?? null;
  const selectedForm = forms.find((form) => form.form_id === selectedFormId) ?? null;
  const selectedPageForms = forms
    .filter((form) => form.page_id === selectedPageId)
    .filter((form) => {
      const term = formSearch.trim().toLowerCase();
      if (!term) return true;
      return `${form.form_name ?? ""} ${form.form_id}`.toLowerCase().includes(term);
    });

  const {
    data: formFields,
    isLoading: loadingFormFields,
    refetch: refetchFormFields,
  } = useQuery({
    queryKey: ["meta-form-fields", selectedFormId],
    enabled: drawerOpen && drawerView === "mapping" && !!selectedFormId,
    queryFn: async () => getMetaFormFields({ formId: selectedFormId! }),
  });

  useEffect(() => {
    if (!formFields) return;

    const nextMapping: Record<string, string> = {};
    const nextValues: Record<string, string> = {};

    for (const field of formFields.fields) {
      const crmField = formFields.mapping[field.key] ?? "__ignore__";
      nextMapping[field.key] = crmField;
      nextValues[field.key] = testValues[field.key] ?? TEST_VALUE_PLACEHOLDERS[crmField] ?? "";
    }

    setFieldMapping(nextMapping);
    setTestValues(nextValues);
    const savedEmpreendimentoId = formFields.form.id_empreendimento;
    setSelectedEmpreendimentoId(
      savedEmpreendimentoId
        ? String(savedEmpreendimentoId)
        : formFields.empreendimentos.length === 1
          ? String(formFields.empreendimentos[0].id)
          : "",
    );
  }, [formFields]);

  const openMetaManager = () => {
    setDrawerView("pages");
    if (!lastSync && forms.length === 0) {
      void handleSyncForms();
    }
  };

  const handleSyncForms = async () => {
    try {
      setSyncing(true);
      const result = await syncMetaForms();
      setLastSync(result);
      if (result.formsCount > 0 && result.errors.length > 0) {
        toast.warning(
          `${result.formsCount} formulário(s) sincronizado(s), com ${result.errors.length} alerta(s)`,
        );
      } else if (result.formsCount > 0) {
        toast.success(`${result.formsCount} formulário(s) sincronizado(s)`);
      } else if (result.pagesCount > 0) {
        toast.info(`${result.pagesCount} página(s) encontrada(s), mas nenhum formulário retornado`);
      } else {
        toast.warning("A Meta não retornou páginas para esta conexão");
      }
      await qc.invalidateQueries({ queryKey: ["meta-integration-status"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao sincronizar formulários");
    } finally {
      setSyncing(false);
    }
  };

  const handleSelectPage = (pageId: string) => {
    setSelectedPageId(pageId);
    setSelectedFormId(null);
    setFormSearch("");
    setDrawerView("forms");
  };

  const handleEditFormMapping = (form: MetaForm) => {
    setSelectedFormId(form.form_id);
    setFieldMapping({});
    setSelectedEmpreendimentoId("");
    setTestValues({});
    setDrawerView("mapping");
  };

  const handleSaveMapping = async () => {
    if (!selectedFormId || !formFields) return;
    const empreendimentoId = Number(selectedEmpreendimentoId);
    if (!Number.isSafeInteger(empreendimentoId) || empreendimentoId <= 0) {
      toast.error("Selecione o empreendimento que receberá os leads");
      return;
    }

    try {
      setSavingMapping(true);
      await saveMetaFieldMapping({
        formId: selectedFormId,
        empreendimentoId,
        mapping: formFields.fields.map((field) => ({
          metaFieldKey: field.key,
          crmField: fieldMapping[field.key] ?? "__ignore__",
        })),
      });
      toast.success("Mapeamento salvo");
      await Promise.all([
        refetchFormFields(),
        qc.invalidateQueries({ queryKey: ["meta-integration-status"] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar mapeamento");
    } finally {
      setSavingMapping(false);
    }
  };

  const handleCreateTestLead = async () => {
    if (!selectedFormId || !formFields) return;
    if (!formFields.form.id_empreendimento) {
      toast.error("Salve o mapeamento e o empreendimento antes de criar o lead teste");
      return;
    }

    try {
      setCreatingTestLead(true);
      const result = await createMetaTestLead({
        formId: selectedFormId,
        fieldValues: testValues,
      });
      toast.success(`Lead teste criado: #${result.leadId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar lead teste");
    } finally {
      setCreatingTestLead(false);
    }
  };

  const handleDisconnected = () => {
    setDrawerOpen(false);
    setDrawerView("account");
    setSelectedPageId(null);
    setSelectedFormId(null);
    setLastSync(null);
    void qc.invalidateQueries({ queryKey: ["meta-integration-status"] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="text-sm text-muted-foreground">Conecte fontes externas de leads ao seu CRM</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5" style={{ backgroundColor: "#13151F", borderColor: "#2A2D3A" }}>
          <div className="flex items-start gap-4">
            <div
              className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: "rgba(24,119,242,0.12)" }}
            >
              <Facebook className="h-6 w-6" style={{ color: "#1877F2" }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-foreground">Meta Ads — Lead Ads</h3>
                {isLoading ? (
                  <Badge variant="secondary" className="text-[10px]">
                    …
                  </Badge>
                ) : connected ? (
                  <Badge
                    className="text-[10px] border-0"
                    style={{ backgroundColor: "rgba(34,197,94,0.15)", color: "#22c55e" }}
                  >
                    Conectado
                  </Badge>
                ) : (
                  <Badge
                    className="text-[10px] border-0"
                    style={{ backgroundColor: "rgba(148,163,184,0.15)", color: "#94a3b8" }}
                  >
                    Não conectado
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Receba leads automaticamente dos seus formulários do Facebook e Instagram
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {connected ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDrawerOpen(true);
                        openMetaManager();
                      }}
                    >
                      Acessar
                    </Button>
                    <DisconnectMetaButton
                      className="gap-2"
                      onDisconnected={handleDisconnected}
                      variant="outline"
                    />
                  </>
                ) : (
                  <Button
                    size="sm"
                    className="gap-2"
                    disabled={connecting}
                    style={{ backgroundColor: "#1877F2", color: "#fff" }}
                    onClick={startMetaOAuth}
                  >
                    <Facebook className="h-4 w-4" />
                    {connecting ? "Aguardando..." : "Conectar com Facebook"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          className="w-full sm:max-w-3xl flex flex-col"
          style={{ backgroundColor: "#13151F", borderColor: "#2A2D3A" }}
        >
          <SheetHeader>
            {drawerView === "forms" || drawerView === "mapping" ? (
              <Button
                variant="ghost"
                size="sm"
                className="mb-2 h-8 w-fit gap-1.5 px-2"
                onClick={() => setDrawerView(drawerView === "mapping" ? "forms" : "pages")}
              >
                <ChevronLeft className="h-4 w-4" />
                {drawerView === "mapping" ? "Formulários" : "Páginas"}
              </Button>
            ) : null}
            <SheetTitle>
              {drawerView === "mapping"
                ? selectedForm?.form_name ?? "Combinar campos"
                : drawerView === "forms"
                ? selectedPage?.pageName ?? "Formulários"
                : drawerView === "pages"
                  ? "Páginas do Meta Lead Ads"
                  : "Conexão Meta Ads"}
            </SheetTitle>
            <SheetDescription>
              {drawerView === "mapping"
                ? "Combine os campos do formulário Meta com os campos do CRM."
                : drawerView === "forms"
                ? "Selecione os formulários e ajuste a combinação de campos."
                : drawerView === "pages"
                  ? "Selecione uma página para visualizar os formulários disponíveis."
                  : "Detalhes da conta conectada e formulários sincronizados."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto mt-4 space-y-5">
            {drawerView === "account" && (
              <div className="rounded-lg border p-4" style={{ borderColor: "#2A2D3A" }}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Conta Meta
                </div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {connection?.user_name ?? "Conta sem nome"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  ID: {connection?.user_id_meta}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={connecting} onClick={startMetaOAuth}>
                    {connecting ? "Aguardando..." : "Reconfigurar acesso"}
                  </Button>
                  <Button size="sm" className="gap-2" onClick={openMetaManager}>
                    Acessar
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {drawerView === "pages" && (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative w-full sm:max-w-xs">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={pageSearch}
                      onChange={(event) => setPageSearch(event.target.value)}
                      placeholder="Buscar pelo nome da página"
                      className="pl-9"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={connecting}
                      onClick={startMetaOAuth}
                    >
                      {connecting ? "Aguardando..." : "Conectar página"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={syncing}
                      onClick={handleSyncForms}
                    >
                      <RefreshCw
                        className={syncing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
                      />
                      {syncing ? "Sincronizando" : "Atualizar"}
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border overflow-hidden" style={{ borderColor: "#2A2D3A" }}>
                  <div
                    className="grid grid-cols-[1fr_130px_38px] gap-3 border-b px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground"
                    style={{ borderColor: "#2A2D3A" }}
                  >
                    <div>Página da Meta</div>
                    <div>Formulários</div>
                    <div />
                  </div>
                  {filteredPages.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Nenhuma página retornada. Use Conectar página para revisar BM/páginas no
                      Facebook e depois clique em Atualizar.
                    </div>
                  ) : (
                    filteredPages.map((page) => (
                      <button
                        key={page.pageId}
                        type="button"
                        className="group grid w-full cursor-pointer grid-cols-[1fr_130px_38px] items-center gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                        style={{ borderColor: "#2A2D3A" }}
                        onClick={() => handleSelectPage(page.pageId)}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {page.pageName ?? page.pageId}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{page.pageId}</div>
                        </div>
                        <div className="text-sm text-muted-foreground">{page.formsCount}</div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                      </button>
                    ))
                  )}
                </div>

                {lastSync && lastSync.pagesCount === 0 && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    A Meta não retornou páginas para esta conta. Clique em Conectar página e, na tela
                    do Facebook, use Editar configurações para selecionar a BM/páginas certas.
                  </p>
                )}
              </>
            )}

            {drawerView === "forms" && (
              <>
                <div className="relative w-full sm:max-w-xs">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={formSearch}
                    onChange={(event) => setFormSearch(event.target.value)}
                    placeholder="Buscar formulário"
                    className="pl-9"
                  />
                </div>

                <div className="rounded-lg border overflow-hidden" style={{ borderColor: "#2A2D3A" }}>
                  <div
                    className="grid grid-cols-[1fr_140px_132px] gap-3 border-b px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground"
                    style={{ borderColor: "#2A2D3A" }}
                  >
                    <div>Nome do formulário</div>
                    <div>Status da combinação</div>
                    <div />
                  </div>
                  {selectedPageForms.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Nenhum formulário retornado para esta página.
                    </div>
                  ) : (
                    selectedPageForms.map((form) => (
                      <div
                        key={form.id}
                        className="grid grid-cols-[1fr_140px_132px] items-center gap-3 border-b px-4 py-3"
                        style={{ borderColor: "#2A2D3A" }}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {form.form_name ?? form.form_id}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {typeof form.leads_count === "number"
                              ? `${form.leads_count} leads na Meta`
                              : form.form_id}
                          </div>
                        </div>
                        <div>
                          {Number(form.mapped_fields_count ?? 0) >= 2 && form.id_empreendimento ? (
                            <Badge
                              className="border-0 text-[10px]"
                              style={{
                                backgroundColor: "rgba(34,197,94,0.15)",
                                color: "#22c55e",
                              }}
                            >
                              Concluído
                            </Badge>
                          ) : (
                          <Badge
                            className="border-0 text-[10px]"
                            style={{
                              backgroundColor: "rgba(148,163,184,0.15)",
                              color: "#cbd5e1",
                            }}
                          >
                            Pendente
                          </Badge>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditFormMapping(form)}
                        >
                          Combinar campos
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {drawerView === "mapping" && (
              <>
                {loadingFormFields ? (
                  <div className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
                    Carregando campos do formulário...
                  </div>
                ) : !formFields || formFields.fields.length === 0 ? (
                  <div className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum campo retornado pela Meta para este formulário.
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border p-4" style={{ borderColor: "#2A2D3A" }}>
                      <div className="max-w-md space-y-2">
                        <Label htmlFor="meta-empreendimento">Empreendimento *</Label>
                        <Select
                          value={selectedEmpreendimentoId}
                          onValueChange={setSelectedEmpreendimentoId}
                        >
                          <SelectTrigger id="meta-empreendimento">
                            <SelectValue placeholder="Selecionar empreendimento" />
                          </SelectTrigger>
                          <SelectContent>
                            {formFields.empreendimentos.map((empreendimento) => (
                              <SelectItem key={empreendimento.id} value={String(empreendimento.id)}>
                                {empreendimento.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Todos os leads recebidos por este formulário serão vinculados a este empreendimento.
                        </p>
                        {formFields.empreendimentos.length === 0 ? (
                          <p className="text-xs text-destructive">
                            Nenhum empreendimento disponível para esta empresa.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div
                      className="rounded-lg border overflow-hidden mt-4"
                      style={{ borderColor: "#2A2D3A" }}
                    >
                      <div
                        className="grid grid-cols-[1fr_180px_1fr] gap-3 border-b px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground"
                        style={{ borderColor: "#2A2D3A" }}
                      >
                        <div>Campo Meta</div>
                        <div>Campo no CRM</div>
                        <div>Valor para teste</div>
                      </div>

                      {formFields.fields.map((field) => {
                        const selectedCrmField = fieldMapping[field.key] ?? "__ignore__";

                        return (
                          <div
                            key={field.key}
                            className="grid grid-cols-[1fr_180px_1fr] items-center gap-3 border-b px-4 py-3"
                            style={{ borderColor: "#2A2D3A" }}
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">
                                {field.label}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {field.key}
                                {field.type ? ` · ${field.type}` : ""}
                              </div>
                            </div>

                            <Select
                              value={selectedCrmField}
                              onValueChange={(value) => {
                                setFieldMapping((current) => ({
                                  ...current,
                                  [field.key]: value,
                                }));
                                setTestValues((current) => ({
                                  ...current,
                                  [field.key]:
                                    current[field.key] || TEST_VALUE_PLACEHOLDERS[value] || "",
                                }));
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CRM_FIELD_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <Input
                              value={testValues[field.key] ?? ""}
                              onChange={(event) =>
                                setTestValues((current) => ({
                                  ...current,
                                  [field.key]: event.target.value,
                                }))
                              }
                              placeholder={TEST_VALUE_PLACEHOLDERS[selectedCrmField] ?? "Valor"}
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div className="rounded-lg border p-4" style={{ borderColor: "#2A2D3A" }}>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Obrigatórios</Label>
                          <div className="text-sm text-foreground">Nome, Telefone e Empreendimento</div>
                        </div>
                        <div className="flex flex-wrap items-end justify-start gap-2 sm:justify-end">
                          <Button
                            variant="outline"
                            disabled={savingMapping || !selectedEmpreendimentoId}
                            onClick={handleSaveMapping}
                          >
                            {savingMapping ? "Salvando..." : "Salvar mapeamento"}
                          </Button>
                          <Button
                            disabled={creatingTestLead}
                            onClick={handleCreateTestLead}
                          >
                            {creatingTestLead ? "Criando..." : "Criar lead teste"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

          </div>
        </SheetContent>
      </Sheet>

      {/* Hidden icon to keep import used in design phase */}
      <Plug className="hidden" />
    </div>
  );
}

function DisconnectMetaButton({
  className,
  onDisconnected,
  variant = "destructive",
}: DisconnectMetaButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size="sm" className={className}>
          <Unplug className="h-4 w-4" />
          Desconectar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desconectar Meta Ads?</AlertDialogTitle>
          <AlertDialogDescription>
            Você deixará de receber leads dos formulários do Facebook e Instagram. Esta ação pode ser
            revertida reconectando a conta.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              try {
                await disconnectMetaConnection();
                toast.success("Conta Meta desconectada");
                onDisconnected();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Falha ao desconectar");
              }
            }}
          >
            Desconectar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
