import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Facebook,
  Plug,
  RefreshCw,
  Search,
  Settings,
  Unplug,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  createMetaOAuthUrl,
  disconnectMetaConnection,
  enrichMetaAttribution,
  exchangeMetaCode,
  type MetaFormsSyncResult,
  getMetaFormFields,
  getMetaIntegrationStatus,
  recoverMetaLeads,
  saveMetaFieldMapping,
  syncMetaForms,
} from "@/lib/meta-oauth.functions";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RdStationIntegrationCard } from "@/components/rd-station-integration-card";
import { WhatsAppBusinessIntegrationCard } from "@/components/whatsapp-business-integration-card";
import { WhatsAppMetaReviewPanel } from "@/components/whatsapp-meta-review-panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/configuracoes/integracoes")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: me } = await supabase
      .from("crm_users")
      .select("role")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();
    if (!me || me.role !== "manager") {
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
  health_status: "unknown" | "healthy" | "degraded" | "error";
  last_health_check_at: string | null;
  last_error: string | null;
  selected_page_ids: string[];
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
  id_funnel: number | null;
  mapped_fields_count?: number;
  webhook_subscribed: boolean;
  webhook_checked_at: string | null;
  webhook_error: string | null;
  last_recovered_at: string | null;
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
  selected: boolean;
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
  origem: "FB",
  observacoes: "Lead criado pelo simulador",
};

function formatIntegrationDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

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
  const { activeEmpresaId } = useActiveEmpresa();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [savingPages, setSavingPages] = useState(false);
  const [enrichingAttribution, setEnrichingAttribution] = useState(false);
  const [recoveringLeads, setRecoveringLeads] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryFormId, setRecoveryFormId] = useState("");
  const [recoverySince, setRecoverySince] = useState("");
  const [recoveryUntil, setRecoveryUntil] = useState("");
  const [lastSync, setLastSync] = useState<MetaFormsSyncResult | null>(null);
  const [selectedMetaPageIds, setSelectedMetaPageIds] = useState<string[]>([]);
  const [pageSelectionDirty, setPageSelectionDirty] = useState(false);
  const [drawerView, setDrawerView] = useState<MetaDrawerView>("account");
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [pageSearch, setPageSearch] = useState("");
  const [formSearch, setFormSearch] = useState("");
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [selectedEmpreendimentoId, setSelectedEmpreendimentoId] = useState("");
  const [selectedFunnelId, setSelectedFunnelId] = useState("");
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [savingMapping, setSavingMapping] = useState(false);

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
    queryKey: ["meta-integration-status", activeEmpresaId],
    enabled: Boolean(activeEmpresaId),
    queryFn: async () => {
      return getMetaIntegrationStatus();
    },
  });

  const connection = (status?.connection as MetaConnection | null | undefined) ?? null;
  const forms = useMemo(() => (status?.forms as MetaForm[] | undefined) ?? [], [status?.forms]);
  const persistedMetaPageIds = useMemo(
    () => connection?.selected_page_ids ?? [],
    [connection?.selected_page_ids],
  );
  const recoveryForms = forms.filter(
    (form) =>
      Number(form.mapped_fields_count ?? 0) >= 2 &&
      Boolean(form.id_empreendimento) &&
      Boolean(form.id_funnel),
  );

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
        selected: persistedMetaPageIds.includes(form.page_id),
      });
    }

    for (const page of lastSync?.pages ?? []) {
      const current = byId.get(page.pageId);
      byId.set(page.pageId, {
        pageId: page.pageId,
        pageName: page.pageName ?? current?.pageName ?? null,
        formsCount: Math.max(page.formsCount, current?.formsCount ?? 0),
        source: page.source ?? current?.source ?? null,
        selected: persistedMetaPageIds.includes(page.pageId),
      });
    }

    return Array.from(byId.values())
      .filter((page) => page.formsCount > 0 || page.selected)
      .sort((a, b) => (a.pageName ?? a.pageId).localeCompare(b.pageName ?? b.pageId));
  }, [forms, lastSync, persistedMetaPageIds]);

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
    queryKey: ["meta-form-fields", activeEmpresaId, selectedFormId],
    enabled: drawerOpen && drawerView === "mapping" && !!selectedFormId,
    queryFn: async () => getMetaFormFields({ formId: selectedFormId! }),
  });

  useEffect(() => {
    setDrawerOpen(false);
    setDrawerView("account");
    setSelectedPageId(null);
    setSelectedFormId(null);
    setLastSync(null);
    setSelectedMetaPageIds([]);
    setPageSelectionDirty(false);
  }, [activeEmpresaId]);

  useEffect(() => {
    if (!connection || pageSelectionDirty) return;
    setSelectedMetaPageIds(connection.selected_page_ids ?? []);
  }, [connection, pageSelectionDirty]);

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
    const savedFunnelId = formFields.form.id_funnel;
    const defaultFunnel = formFields.funnels.find((funnel) => funnel.is_default);
    setSelectedFunnelId(
      savedFunnelId
        ? String(savedFunnelId)
        : formFields.funnels.length === 1
          ? String(formFields.funnels[0].id)
          : defaultFunnel
            ? String(defaultFunnel.id)
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
      if (!pageSelectionDirty) {
        setSelectedMetaPageIds(
          result.pages.filter((page) => page.selected).map((page) => page.pageId),
        );
      }
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

  const toggleMetaPage = (pageId: string, checked: boolean) => {
    setPageSelectionDirty(true);
    setSelectedMetaPageIds((current) =>
      checked
        ? Array.from(new Set([...current, pageId]))
        : current.filter((currentPageId) => currentPageId !== pageId),
    );
  };

  const handleSavePageSelection = async () => {
    const pageIdsToSave = Array.from(new Set(selectedMetaPageIds));
    if (pageIdsToSave.length === 0) {
      toast.error("Selecione ao menos uma página para esta empresa");
      return;
    }

    try {
      setSavingPages(true);
      const result = await syncMetaForms({ pageIds: pageIdsToSave });
      setLastSync(result);
      setSelectedMetaPageIds(
        result.pages.filter((page) => page.selected).map((page) => page.pageId),
      );
      if (result.errors.length > 0) {
        toast.warning(`Seleção salva, mas ${result.errors.length} página(s) precisam de atenção.`);
      } else {
        toast.success("Páginas desta empresa salvas e sincronizadas");
      }
      await qc.refetchQueries({
        queryKey: ["meta-integration-status", activeEmpresaId],
        type: "active",
      });
      setPageSelectionDirty(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar páginas da empresa");
    } finally {
      setSavingPages(false);
    }
  };

  const handleEnrichAttribution = async () => {
    try {
      setEnrichingAttribution(true);
      const result = await enrichMetaAttribution({ limit: 50 });

      if (result.failed.length > 0) {
        toast.warning(
          `${result.enriched} de ${result.checked} lead(s) atualizado(s). ${result.failed.length} falha(s) ao consultar anúncios.`,
        );
      } else if (result.enriched > 0) {
        toast.success(`${result.enriched} lead(s) atualizado(s) com dados do anúncio.`);
      } else {
        toast.info("Nenhum lead Meta com anúncio pendente de atualização foi encontrado.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao atualizar os dados de anúncios da Meta",
      );
    } finally {
      setEnrichingAttribution(false);
    }
  };

  const openRecoveryDialog = () => {
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);
    const toInputDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    setRecoveryFormId(recoveryForms.length === 1 ? recoveryForms[0].form_id : "");
    setRecoverySince(toInputDate(sevenDaysAgo));
    setRecoveryUntil(toInputDate(today));
    setRecoveryOpen(true);
  };

  const handleRecoverLeads = async () => {
    if (!recoveryFormId) {
      toast.error("Selecione o formulario que deve ser recuperado");
      return;
    }
    if (!recoverySince || !recoveryUntil) {
      toast.error("Informe as datas inicial e final");
      return;
    }

    try {
      setRecoveringLeads(true);
      const result = await recoverMetaLeads({
        formId: recoveryFormId,
        since: new Date(`${recoverySince}T00:00:00`).toISOString(),
        until: new Date(`${recoveryUntil}T23:59:59.999`).toISOString(),
        limitPerForm: 500,
      });
      if (result.failed.length > 0) {
        toast.warning(
          `${result.recovered} lead(s) recuperado(s); ${result.failed.length} falha(s). Verifique a autorizacao da pagina.`,
        );
      } else if (result.warnings.length > 0) {
        toast.warning(
          `${result.recovered} lead(s) recuperado(s); ${result.warnings.length} registro(s) incompleto(s) ignorado(s).`,
        );
      } else if (result.recovered > 0) {
        toast.success(`${result.recovered} lead(s) recuperado(s) da Meta.`);
      } else {
        toast.info(`${result.checked} lead(s) verificado(s); nenhum estava faltando.`);
      }
      if (result.failed.length === 0) setRecoveryOpen(false);
      await qc.invalidateQueries({ queryKey: ["meta-integration-status", activeEmpresaId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao recuperar leads da Meta");
    } finally {
      setRecoveringLeads(false);
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
    setSelectedFunnelId("");
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
    const funnelId = Number(selectedFunnelId);
    if (!Number.isSafeInteger(funnelId) || funnelId <= 0) {
      toast.error("Selecione o funil que receberá os leads");
      return;
    }

    try {
      setSavingMapping(true);
      await saveMetaFieldMapping({
        formId: selectedFormId,
        empreendimentoId,
        funnelId,
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

  const handleDisconnected = () => {
    setDrawerOpen(false);
    setDrawerView("account");
    setSelectedPageId(null);
    setSelectedFormId(null);
    setLastSync(null);
    setSelectedMetaPageIds([]);
    setPageSelectionDirty(false);
    void qc.invalidateQueries({ queryKey: ["meta-integration-status"] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="text-sm text-muted-foreground">Conecte fontes externas de leads ao seu CRM</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card
          className="p-5"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
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
                ) : connected && connection.health_status === "healthy" ? (
                  <Badge
                    className="text-[10px] border-0"
                    style={{ backgroundColor: "var(--success-bg)", color: "var(--success)" }}
                  >
                    Conectado
                  </Badge>
                ) : connected ? (
                  <Badge variant="destructive" className="text-[10px]">
                    Requer atencao
                  </Badge>
                ) : (
                  <Badge
                    className="text-[10px] border-0"
                    style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}
                  >
                    Não conectado
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Receba leads automaticamente dos seus formulários do Facebook e Instagram
              </p>
              {connected ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {status?.summary.processed ?? 0} processado(s)
                  {` · último evento ${formatIntegrationDate(status?.summary.last_event_at)}`}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {connected ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => {
                        setDrawerOpen(true);
                        openMetaManager();
                      }}
                    >
                      <Settings className="h-4 w-4" />
                      Acessar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={enrichingAttribution}
                      onClick={handleEnrichAttribution}
                    >
                      <RefreshCw
                        className={enrichingAttribution ? "h-4 w-4 animate-spin" : "h-4 w-4"}
                      />
                      {enrichingAttribution ? "Atualizando..." : "Atualizar anúncios"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={recoveringLeads}
                      onClick={openRecoveryDialog}
                    >
                      <RefreshCw className={recoveringLeads ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                      Recuperar leads
                    </Button>
                    <DisconnectMetaButton
                      className="gap-2 text-destructive"
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
        <WhatsAppBusinessIntegrationCard />
        <RdStationIntegrationCard />
      </div>

      <WhatsAppMetaReviewPanel />

      <Dialog open={recoveryOpen} onOpenChange={setRecoveryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recuperar leads da Meta</DialogTitle>
            <DialogDescription>
              Escolha um unico formulario e o periodo exato. Registros ja existentes nao serao
              duplicados.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Formulario</Label>
              <Select value={recoveryFormId} onValueChange={setRecoveryFormId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o formulario" />
                </SelectTrigger>
                <SelectContent>
                  {recoveryForms.map((form) => (
                    <SelectItem key={form.form_id} value={form.form_id}>
                      {form.form_name ?? form.form_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="meta-recovery-since">De</Label>
                <Input
                  id="meta-recovery-since"
                  type="date"
                  value={recoverySince}
                  onChange={(event) => setRecoverySince(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meta-recovery-until">Ate</Label>
                <Input
                  id="meta-recovery-until"
                  type="date"
                  value={recoveryUntil}
                  onChange={(event) => setRecoveryUntil(event.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Periodo maximo: 31 dias.</p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRecoveryOpen(false)}
              disabled={recoveringLeads}
            >
              Cancelar
            </Button>
            <Button onClick={handleRecoverLeads} disabled={recoveringLeads}>
              {recoveringLeads ? "Recuperando..." : "Recuperar periodo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          className="w-full sm:max-w-3xl flex flex-col"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
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
                ? (selectedForm?.form_name ?? "Combinar campos")
                : drawerView === "forms"
                  ? (selectedPage?.pageName ?? "Formulários")
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
              <div className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
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
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={connecting}
                    onClick={startMetaOAuth}
                  >
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
                      {connecting ? "Aguardando..." : "Reautorizar Meta"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={syncing}
                      onClick={handleSyncForms}
                    >
                      <RefreshCw className={syncing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                      {syncing ? "Sincronizando" : "Atualizar"}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Marque somente as páginas que pertencem a esta empresa. O mesmo usuário do
                    Facebook pode administrar páginas de empresas diferentes.
                  </p>
                  <Button
                    size="sm"
                    className="shrink-0"
                    disabled={savingPages || syncing}
                    onClick={handleSavePageSelection}
                  >
                    {savingPages ? "Salvando..." : "Salvar páginas"}
                  </Button>
                </div>

                {lastSync && lastSync.errors.length > 0 ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                    <div className="flex items-center gap-2 font-medium">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      Algumas páginas ainda não estão habilitadas para receber leads
                    </div>
                    <div className="mt-2 space-y-1 text-amber-900 dark:text-amber-200">
                      {lastSync.errors.slice(0, 3).map((error) => (
                        <p key={`${error.pageId}-${error.message}`}>
                          <span className="font-medium">{error.pageName ?? error.pageId}:</span>{" "}
                          {error.message}
                        </p>
                      ))}
                      {lastSync.errors.length > 3 ? (
                        <p>Mais {lastSync.errors.length - 3} alerta(s).</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div
                  className="rounded-lg border overflow-hidden"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div
                    className="grid grid-cols-[42px_1fr_130px_90px_38px] gap-3 border-b px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div>Usar</div>
                    <div>Página da Meta</div>
                    <div>Formulários</div>
                    <div>Status</div>
                    <div />
                  </div>
                  {filteredPages.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Nenhuma página retornada. Use Conectar página para revisar BM/páginas no
                      Facebook e depois clique em Atualizar.
                    </div>
                  ) : (
                    filteredPages.map((page) => (
                      <div
                        key={page.pageId}
                        className="group grid w-full grid-cols-[42px_1fr_130px_90px_38px] items-center gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-[var(--primary-50)]"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <Checkbox
                          checked={selectedMetaPageIds.includes(page.pageId)}
                          aria-label={`Usar página ${page.pageName ?? page.pageId} nesta empresa`}
                          onCheckedChange={(checked) =>
                            toggleMetaPage(page.pageId, checked === true)
                          }
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {page.pageName ?? page.pageId}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {page.pageId}
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground">{page.formsCount}</div>
                        <Badge
                          variant={page.selected ? "secondary" : "outline"}
                          className="w-fit text-[10px]"
                        >
                          {page.selected ? "Selecionada" : "Disponível"}
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={!page.selected || savingPages || syncing}
                          aria-label={`Abrir formulários de ${page.pageName ?? page.pageId}`}
                          onClick={() => handleSelectPage(page.pageId)}
                        >
                          <ArrowRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>

                {lastSync && lastSync.pagesCount === 0 && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    A Meta não retornou páginas para esta conta. Clique em Conectar página e, na
                    tela do Facebook, use Editar configurações para selecionar a BM/páginas certas.
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

                <div
                  className="rounded-lg border overflow-hidden"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div
                    className="grid grid-cols-[1fr_140px_132px] gap-3 border-b px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground"
                    style={{ borderColor: "var(--border)" }}
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
                    selectedPageForms.map((form) => {
                      const isConnected =
                        Number(form.mapped_fields_count ?? 0) >= 2 &&
                        Boolean(form.id_empreendimento) &&
                        Boolean(form.id_funnel) &&
                        form.webhook_subscribed;

                      return (
                        <div
                          key={form.id}
                          className={`grid grid-cols-[1fr_140px_132px] items-center gap-3 border-b px-4 py-3 transition-colors ${
                            isConnected ? "bg-emerald-50/70" : ""
                          }`}
                          style={{ borderColor: "var(--border)" }}
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
                            {isConnected ? (
                              <Badge className="w-fit gap-1 border border-emerald-200 bg-emerald-100 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100">
                                <CheckCircle2 className="h-3 w-3" />
                                Conectado
                              </Badge>
                            ) : (
                              <Badge
                                className="border-0 text-[10px]"
                                style={{
                                  backgroundColor: "var(--surface-2)",
                                  color: "var(--text-secondary)",
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
                      );
                    })
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
                    <div className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
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
                          Todos os leads recebidos por este formulário serão vinculados a este
                          empreendimento.
                        </p>
                        {formFields.empreendimentos.length === 0 ? (
                          <p className="text-xs text-destructive">
                            Nenhum empreendimento disponível para esta empresa.
                          </p>
                        ) : null}
                      </div>
                      {formFields.funnels.length > 1 ? (
                        <div className="mt-4 max-w-md space-y-2">
                          <Label htmlFor="meta-funnel">Funil *</Label>
                          <Select value={selectedFunnelId} onValueChange={setSelectedFunnelId}>
                            <SelectTrigger id="meta-funnel">
                              <SelectValue placeholder="Selecionar funil" />
                            </SelectTrigger>
                            <SelectContent>
                              {formFields.funnels.map((funnel) => (
                                <SelectItem key={funnel.id} value={String(funnel.id)}>
                                  {funnel.nome}
                                  {funnel.is_default ? " (padrão)" : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            Os leads entrarão no primeiro estágio deste funil.
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <div
                      className="rounded-lg border overflow-hidden mt-4"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <div
                        className="grid grid-cols-[1fr_180px_1fr] gap-3 border-b px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground"
                        style={{ borderColor: "var(--border)" }}
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
                            style={{ borderColor: "var(--border)" }}
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

                    <div className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Obrigatórios</Label>
                          <div className="text-sm text-foreground">
                            Nome, Telefone e Empreendimento
                            {formFields.funnels.length > 1 ? ", Funil" : ""}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-end justify-start gap-2 sm:justify-end">
                          <Button
                            variant="outline"
                            disabled={
                              savingMapping || !selectedEmpreendimentoId || !selectedFunnelId
                            }
                            onClick={handleSaveMapping}
                          >
                            {savingMapping ? "Salvando..." : "Salvar mapeamento"}
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
            Você deixará de receber leads dos formulários do Facebook e Instagram. Esta ação pode
            ser revertida reconectando a conta.
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
