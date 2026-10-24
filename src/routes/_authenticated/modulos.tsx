import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Bot, BriefcaseBusiness } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useCrmUser } from "@/hooks/use-crm-user";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { db, Notice, inputClass, actionClass, secondaryClass, type Modules } from "@/hml/modules";
import { companyApi } from "@/hml/company-api";
import { ConfigLayout } from "@/components/config-layout";

export const Route = createFileRoute("/_authenticated/modulos")({
  component: () => (
    <ConfigLayout>
      <ModulesPage />
    </ConfigLayout>
  ),
});
function ModulesPage() {
  const { data: me } = useCrmUser();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [ia, setIA] = useState(false);
  const [crm, setCRM] = useState(true);
  const [mode, setMode] = useState("new");
  const [existingId, setExistingId] = useState("");
  const query = useQuery({
    queryKey: ["module-admin", me?.id],
    enabled: me?.role === "super_admin",
    queryFn: async () => {
      return companyApi(db).catalog();
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      return companyApi(db).register({existingId:mode === "existing" ? Number(existingId) : null,name,ia,crm,requestId});
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      setOpen(false);
      toast.success("Empresa salva. Ela já aparece no seletor de empresas.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (me?.role !== "super_admin")
    return (
      <Notice title="Acesso restrito">Somente o administrador pode configurar módulos.</Notice>
    );
  return (
    <div className="max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Empresas e módulos</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Cadastre ou vincule empresas e defina quais módulos poderão utilizar.
          </p>
        </div>
        <button
          className={actionClass + " flex items-center gap-2"}
          onClick={() => {
            setName("");
            setMode("new");
            setExistingId("");
            setIA(false);
            setCRM(true);
            setRequestId(crypto.randomUUID());
            setOpen(true);
          }}
        >
          <Plus size={16} />
          Nova empresa
        </button>
      </header>
      <div className="rounded-xl border border-primary/15 bg-accent p-4 text-sm text-accent-foreground">
        Habilitar o CRM libera o módulo. O destino atual dos leads é preservado e o histórico não é
        reenviado. Desabilitar um módulo suspende seu acesso e mantém os dados.
      </div>
      {query.isPending ? (
        <p>Carregando empresas…</p>
      ) : query.isError ? (
        <Notice title="Falha ao carregar empresas">
          <button className={secondaryClass} onClick={() => query.refetch()}>
            Tentar novamente
          </button>
        </Notice>
      ) : (
        query.data.map((company) => <CompanyModulesRow key={company.id} company={company} />)
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!create.isPending) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cadastrar ou vincular empresa</DialogTitle>
            <DialogDescription>
              Um único cadastro para IA, CRM ou ambos. Credenciais e ativação da IA são configuradas
              depois.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <fieldset disabled={create.isPending} className="space-y-4">
              <label className="block text-sm">
                Tipo de cadastro
                <select
                  aria-label="Tipo de cadastro"
                  className={inputClass + " mt-2"}
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value="new">Nova empresa</option>
                  <option value="existing">Vincular empresa existente</option>
                </select>
              </label>
              {mode === "existing" ? (
                <label className="block text-sm">
                  Empresa existente
                  <select
                    required
                    aria-label="Empresa existente"
                    className={inputClass + " mt-2"}
                    value={existingId}
                    onChange={(e) => setExistingId(e.target.value)}
                  >
                    <option value="">Selecione uma empresa sem módulos</option>
                    {query.data
                      ?.filter((c) => !c.modules)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome} · #{c.id}
                        </option>
                      ))}
                  </select>
                  <span className="mt-2 block text-xs text-muted-foreground">
                    Só aparecem registros deste ambiente ainda sem módulos. Empresas já vinculadas
                    são editadas na lista.
                  </span>
                </label>
              ) : (
                <label className="block text-sm">
                  Nome da empresa
                  <input
                    aria-label="Nome da empresa"
                    autoFocus
                    required
                    minLength={2}
                    maxLength={150}
                    className={inputClass + " mt-2"}
                    value={name}
                    disabled={create.isPending}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              <div className="flex gap-5 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={ia} onChange={(e) => setIA(e.target.checked)} />
                  Atendimento IA
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={crm} onChange={(e) => setCRM(e.target.checked)} />
                  CRM comercial
                </label>
              </div>
              {!ia && !crm && (
                <p className="text-sm text-red-700">Selecione pelo menos um módulo.</p>
              )}
              {ia && (
                <p className="rounded-lg bg-muted p-3 text-sm text-foreground">
                  A IA ficará com configuração pendente. Habilitar o módulo não inicia atendimento
                  nem altera o destino dos leads.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className={secondaryClass}
                  onClick={() => setOpen(false)}
                  disabled={create.isPending}
                >
                  Cancelar
                </button>
                <button
                  className={actionClass}
                  disabled={
                    create.isPending || (!ia && !crm) || (mode === "existing" && !existingId)
                  }
                >
                  {create.isPending
                    ? "Salvando…"
                    : mode === "existing"
                      ? "Vincular empresa"
                      : "Cadastrar empresa"}
                </button>
              </div>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function CompanyModulesRow({
  company,
}: {
  company: { id: number; nome: string; default_crm: string | null; modules?: Modules | null };
}) {
  const { setActiveEmpresaId } = useActiveEmpresa();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [ia, setIA] = useState(company.modules?.atendimento_ia ?? false);
  const [crm, setCRM] = useState(company.modules?.crm ?? false);
  useEffect(() => {
    setIA(company.modules?.atendimento_ia ?? false);
    setCRM(company.modules?.crm ?? false);
  }, [company.modules?.revision, company.modules?.atendimento_ia, company.modules?.crm]);
  const save = useMutation({
    mutationFn: async () => {
      await companyApi(db).setModules(company.id,ia,crm,company.modules!.revision);
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast.success("Módulos atualizados. Destino dos leads preservado.");
    },
    onError: async (e: Error) => {
      toast.error(e.message);
      await qc.invalidateQueries();
    },
  });
  const dirty = ia !== company.modules?.atendimento_ia || crm !== company.modules?.crm || company.modules?.source === 'credentials';
  return (
    <section className="rounded-2xl border bg-white p-6">
      <h2 className="text-base font-semibold">{company.nome}</h2>
      {company.modules?.source === "credentials" && (
        <p className="mt-2 text-sm text-muted-foreground">Empresa reconhecida automaticamente pelo HUB. CRM comercial ainda não habilitado.</p>
      )}
      <button
        className={secondaryClass + " mt-3"}
        onClick={() => {
          setActiveEmpresaId(company.id);
          navigate({ to: "/administracao" });
        }}
      >
        Administrar empresa
      </button>
      <p className="mt-1 text-xs text-muted-foreground">
        Destino legado: {company.default_crm ?? "não configurado neste teste"} · Envios desativados
        na homologação
      </p>
      {company.modules?.atendimento_ia && (
        <p className="mt-2 text-sm text-muted-foreground">
          Atendimento IA: configuração pendente nesta homologação.
        </p>
      )}
      {!company.modules ? (
        <p className="mt-4 text-sm text-accent-foreground">
          Empresa sem configuração de módulos. Necessária preparação administrativa.
        </p>
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <label
            className={`flex min-w-52 cursor-pointer items-center gap-3 rounded-xl border p-4 ${ia ? "border-primary/25 bg-muted" : "bg-muted"}`}
          >
            <input
              type="checkbox"
              checked={ia}
              disabled={save.isPending}
              onChange={(e) => setIA(e.target.checked)}
              aria-label={`Atendimento IA — ${company.nome}`}
            />
            <Bot size={19} />
            <span className="text-sm font-medium">Atendimento IA</span>
          </label>
          <label
            className={`flex min-w-52 cursor-pointer items-center gap-3 rounded-xl border p-4 ${crm ? "border-primary/25 bg-accent" : "bg-muted"}`}
          >
            <input
              type="checkbox"
              checked={crm}
              disabled={save.isPending}
              onChange={(e) => setCRM(e.target.checked)}
              aria-label={`CRM — ${company.nome}`}
            />
            <BriefcaseBusiness size={19} />
            <span className="text-sm font-medium">CRM comercial</span>
          </label>
          <button
            className={actionClass + " ml-auto"}
            disabled={!dirty || (!ia && !crm) || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Salvando…" : "Salvar módulos"}
          </button>
          {!ia && !crm && (
            <p className="w-full text-sm text-red-700">Mantenha pelo menos um módulo habilitado.</p>
          )}
        </div>
      )}
    </section>
  );
}

