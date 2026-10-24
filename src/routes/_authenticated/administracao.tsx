import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ConfigHeader, ConfigSection, ConfigStatus, ConfigTabs } from "@/components/config-presentation";
import { ConfigLayout } from "@/components/config-layout";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { useCrmUser } from "@/hooks/use-crm-user";
import { TeamPanel, type TeamMember } from "@/hml/team";
import { db, Notice, actionClass, secondaryClass, inputClass, type Modules } from "@/hml/modules";
import {
  groups,
  companyFields,
  developmentFields,
  RecordEditor,
  useAdminMutation,
  adminRpc,
  type AdminRecord,
  type Capability,
  type Permission,
} from "@/hml/administration";

export const Route = createFileRoute("/_authenticated/administracao")({
  head: () => ({ meta: [{ title: "Empresa e empreendimentos | Katsuki HUB" }, { name: "description", content: "Cadastro da empresa selecionada, empreendimentos e permissões da equipe." }, { property: "og:title", content: "Empresa e empreendimentos | Katsuki HUB" }, { property: "og:description", content: "Cadastro da empresa selecionada, empreendimentos e permissões da equipe." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: () => (
    <ConfigLayout>
      <AdministrationPage />
    </ConfigLayout>
  ),
});
function AdministrationPage() {
  const { activeEmpresaId } = useActiveEmpresa();
  const { data: me } = useCrmUser();
  if (!me || !["super_admin", "manager"].includes(me.role))
    return (
      <Notice title="Acesso restrito">Esta área é destinada à administração e aos gestores.</Notice>
    );
  return activeEmpresaId ? (
    <CompanyAdministration key={activeEmpresaId} companyId={activeEmpresaId} />
  ) : (
    <Notice title="Selecione uma empresa">
      Escolha a empresa no topo para administrar seu cadastro.
    </Notice>
  );
}
function CompanyAdministration({ companyId }: { companyId: number }) {
  const { data: me } = useCrmUser();
  const isAdmin = me?.role === "super_admin";
  const [tab, setTab] = useState("dados");
  const [edit, setEdit] = useState<AdminRecord | null>(null);
  const [search, setSearch] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const query = useQuery({
    queryKey: ["company-administration", companyId, me?.id],
    queryFn: async () => {
      const results = await Promise.all([
        db
          .from("empresa_dados")
          .select("id,nome,site,redes_sociais,admin_revision")
          .eq("id", companyId)
          .single(),
        db.rpc("hub_get_company_modules", { p_company_id: companyId }),
        db
          .from("empreendimento")
          .select(
            ["id", "id_empresa", "admin_revision", ...developmentFields.map((f) => f.key)].join(
              ",",
            ),
          )
          .eq("id_empresa", companyId)
          .order("nome"),
        db.from("hub_admin_permissions").select("*").eq("id_empresa", companyId),
        db
          .from("crm_users")
          .select("id,nome,email,role,active,auth_user_id")
          .eq("id_empresa", companyId)
          .order("nome"),
      ]);
      for (const r of results) if (r.error) throw r.error;
      return {
        company: results[0].data as unknown as AdminRecord,
        modules: results[1].data as Modules | null,
        developments: results[2].data as unknown as AdminRecord[],
        permissions: results[3].data as Permission[],
        members: results[4].data as unknown as TeamMember[],
      };
    },
  });
  const grant = query.data?.permissions.find((p) => p.crm_user_id === me?.id);
  const canEdit = (group: Capability) => isAdmin || !!grant?.[group];
  const saveCompany = useAdminMutation(
    (patch: Record<string, string | null>) =>
      adminRpc("hub_save_company_profile", {
        p_company_id: companyId,
        p_patch: patch,
        p_expected_revision: query.data!.company.admin_revision,
      }),
    "Dados da empresa atualizados",
  );
  const saveDevelopment = useAdminMutation(
    (patch: Record<string, string | null>) =>
      adminRpc("hub_save_development", {
        p_company_id: companyId,
        p_id: edit!.id || null,
        p_patch: patch,
        p_expected_revision: edit!.id ? edit!.admin_revision : null,
        p_request_id: edit!.id ? null : requestId,
      }),
    "Empreendimento salvo",
    () => setEdit(null),
  );
  if (query.isPending) return <p>Carregando administração…</p>;
  if (query.isError)
    return (
      <Notice title="Não foi possível carregar o cadastro">
        <Button variant="outline" className={secondaryClass} onClick={() => query.refetch()}>
          Tentar novamente
        </Button>
      </Notice>
    );
  const { company, modules, developments, members, permissions } = query.data;
  // On a conflict preserve unsaved values; opening the form again loads the new revision.
  return (
    <div className="config-page max-w-6xl space-y-6">
      <ConfigHeader title="Empresa e empreendimentos" context={`${company.nome} · #${company.id}`} description="Cadastro central, empreendimentos e permissões da equipe." />
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <ConfigStatus>CRM: {modules?.crm ? "habilitado" : "não habilitado"}</ConfigStatus>
          <ConfigStatus>Atendimento IA: {modules?.atendimento_ia ? "habilitado" : "não habilitado"}</ConfigStatus>
        </div>
        <p className="text-xs text-muted-foreground">O status considera os módulos configurados e a habilitação existente no HUB.</p>
      </div>
      <ConfigTabs label="Seções da administração" value={tab} onChange={setTab} items={[
        { value: "dados", label: "Dados da empresa" },
        { value: "empreendimentos", label: "Empreendimentos" },
        { value: "permissoes", label: "Equipe e permissões" },
        { value: "historico", label: "Histórico" },
      ]} />
      {tab === "dados" && (
        <ConfigSection>
          <p className="mb-5 text-sm text-muted-foreground">
            Dados institucionais. Telefones operacionais, credenciais e destino dos leads ficam na
            configuração técnica.
          </p>
          <RecordEditor
            key={company.admin_revision}
            record={company}
            fields={companyFields}
            canEdit={canEdit}
            onSave={saveCompany.mutate}
            pending={saveCompany.isPending}
          />
        </ConfigSection>
      )}
      {tab === "empreendimentos" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <input
              aria-label="Buscar empreendimentos"
              className={inputClass + " max-w-sm"}
              placeholder="Buscar empreendimento"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {isAdmin && (
              <Button
                className={actionClass + " flex items-center gap-2"}
                onClick={() => {
                  setRequestId(crypto.randomUUID());
                  setEdit({ id: 0, admin_revision: 0, nome: "" });
                }}
              >
                <Plus size={16} />
                Novo empreendimento
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            As informações comerciais serão compartilhadas com os módulos da empresa. Nesta
            homologação, os envios estão desativados.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {developments
              .filter((d) => d.nome.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
              .map((d) => (
                <article key={d.id} className="rounded-xl border bg-card p-5">
                  <Building2 className="mb-3 text-primary" size={22} />
                  <h2 className="font-semibold">{d.nome}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {String(d.localizacao ?? "Localização não informada")}
                  </p>
                  <p className="mt-2 text-sm">
                    {String(d.preco ?? "Preço não informado")} ·{" "}
                    {String(d.status ?? "Status não informado")}
                  </p>
                  <Button variant="outline" className={secondaryClass + " mt-4"} onClick={() => setEdit(d)}>
                    {developmentFields.some((f) => canEdit(f.group))
                      ? "Ver e editar"
                      : "Ver informações"}
                  </Button>
                </article>
              ))}
          </div>
          {!developments.length && (
            <Notice title="Nenhum empreendimento cadastrado">
              O administrador pode cadastrar o primeiro empreendimento desta empresa.
            </Notice>
          )}
        </section>
      )}
      {tab === "permissoes" && (
        <section className="space-y-4">
          <TeamPanel companyId={companyId} members={members} isAdmin={isAdmin} />
          <h2 className="border-t pt-6 font-semibold">Permissões de edição administrativa</h2>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Libere os grupos de campos individualmente para cada gestor. Novos acessos começam bloqueados."
              : "Estas são as permissões concedidas a você pela administração Katsuki."}{" "}
            Essas permissões são independentes do perfil de acesso ao CRM.
          </p>
          {members
            .filter((m) => m.role === "manager" && (isAdmin || m.id === me?.id))
            .map((member) => (
              <PermissionEditor
                key={
                  member.id +
                  ":" +
                  (permissions.find((p) => p.crm_user_id === member.id)?.revision ?? 0)
                }
                companyId={companyId}
                member={member}
                permission={permissions.find((p) => p.crm_user_id === member.id)}
                isAdmin={isAdmin}
              />
            ))}
          {!members.some((m) => m.role === "manager") && (
            <Notice title="Nenhum gestor vinculado">
              Esta empresa é acessível ao administrador. Cadastre um gestor em Novo membro para
              definir suas permissões.
            </Notice>
          )}
        </section>
      )}
      {tab === "historico" && <AdminHistory companyId={companyId} />}
      <Dialog
        open={!!edit}
        onOpenChange={(open) => {
          if (!open && !saveDevelopment.isPending) setEdit(null);
        }}
      >
        <DialogContent className="config-dialog max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{edit?.id ? edit.nome : "Novo empreendimento"}</DialogTitle>
            <DialogDescription>
              Informações comerciais da empresa {company.nome}. Configurações e instruções técnicas
              da IA são administradas separadamente.
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <RecordEditor
              key={edit.id + ":" + edit.admin_revision}
              record={edit}
              fields={developmentFields}
              canEdit={canEdit}
              creating={!edit.id}
              onSave={saveDevelopment.mutate}
              onCancel={() => setEdit(null)}
              pending={saveDevelopment.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function PermissionEditor({
  companyId,
  member,
  permission,
  isAdmin,
}: {
  companyId: number;
  member: { id: string; nome: string; email: string; active: boolean };
  permission?: Permission;
  isAdmin: boolean;
}) {
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(
        Object.keys(groups).map((k) => [k, !!permission?.[k as Capability]]),
      ) as Record<Capability, boolean>,
  );
  const dirty = (Object.keys(groups) as Capability[]).some((k) => values[k] !== !!permission?.[k]);
  const save = useAdminMutation<void>(
    () =>
      adminRpc("hub_set_admin_permissions", {
        p_company_id: companyId,
        p_user_id: member.id,
        p_permissions: values,
        p_expected_revision: permission?.revision ?? 0,
      }),
    "Permissões atualizadas",
  );
  return (
    <article className="rounded-xl border bg-card p-5">
      <h2 className="font-semibold">
        {member.nome} {!member.active && "· Inativo"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{member.email}</p>
      <fieldset
        disabled={!isAdmin || !member.active || save.isPending}
        className="mt-4 grid gap-3 sm:grid-cols-2"
      >
        {(Object.keys(groups) as Capability[]).map((k) => (
          <label key={k} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
            <input
              aria-label={`${groups[k]} — ${member.nome}`}
              type="checkbox"
              checked={values[k]}
              onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.checked }))}
            />
            {groups[k]}
          </label>
        ))}
      </fieldset>
      {isAdmin && (
        <Button
          disabled={!dirty || !member.active || save.isPending}
          className={actionClass + " mt-4"}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Salvando…" : "Salvar permissões"}
        </Button>
      )}
    </article>
  );
}
function AdminHistory({ companyId }: { companyId: number }) {
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ["admin-history", companyId, page],
    queryFn: async () => {
      const { data, error, count } = await db
        .from("hub_admin_events")
        .select("id,resource,resource_id,action,actor_name,before_data,after_data,created_at", {
          count: "exact",
        })
        .eq("id_empresa", companyId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(page * 20, page * 20 + 19);
      if (error) throw error;
      return { rows: data, total: count ?? 0 };
    },
  });
  const labels: Record<string, string> = Object.fromEntries(
    [...companyFields, ...developmentFields].map((f) => [f.key, f.label]),
  );
  Object.assign(labels, groups, {
    nome: "Nome",
    email: "E-mail",
    role: "Perfil",
    active: "Acesso ativo",
  });
  const display = (v: unknown) =>
    v === true
      ? "Liberado"
      : v === false
        ? "Bloqueado"
        : v === null || v === undefined
          ? "Não informado"
          : v === "manager"
            ? "Gestor"
            : v === "agent"
              ? "Corretor"
              : String(v);
  if (query.isPending) return <p>Carregando histórico…</p>;
  if (query.isError)
    return (
      <Notice title="Não foi possível carregar o histórico">
        <Button onClick={() => query.refetch()}>Tentar novamente</Button>
      </Notice>
    );
  return (
    <section className="space-y-3">
      {query.data.rows.map((event) => (
        <details key={event.id} className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer text-sm">
            <strong>
              {{
                company: "Empresa",
                development: "Empreendimento",
                permissions: "Permissões",
                member: "Membro da equipe",
              }[event.resource as string] ?? event.resource}{" "}
              ·{" "}
              {{
                created: "Cadastro criado",
                linked: "Cadastro vinculado",
                updated: "Alteração salva",
              }[event.action as string] ?? event.action}
            </strong>
            <span className="mt-1 block text-muted-foreground">
              {event.actor_name} · {new Date(event.created_at).toLocaleString("pt-BR")}
            </span>
          </summary>
          <dl className="mt-4 space-y-3 text-sm">
            {Object.keys(event.after_data)
              .filter(
                (k) =>
                  labels[k] &&
                  JSON.stringify(event.before_data?.[k]) !== JSON.stringify(event.after_data[k]),
              )
              .map((k) => (
                <div key={k}>
                  <dt className="font-semibold">{labels[k]}</dt>
                  <dd className="whitespace-pre-wrap break-words text-muted-foreground">
                    {event.before_data ? display(event.before_data[k]) + " → " : ""}
                    {display(event.after_data[k])}
                  </dd>
                </div>
              ))}
          </dl>
        </details>
      ))}
      {!query.data.total && (
        <Notice title="Ainda não há alterações administrativas">
          Novos cadastros e edições serão registrados aqui com autor e data.
        </Notice>
      )}
      <div className="flex items-center justify-between text-sm">
        <Button
          variant="outline" className={secondaryClass}
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </Button>
        <span>{query.data.total} registros</span>
        <Button
          variant="outline" className={secondaryClass}
          disabled={(page + 1) * 20 >= query.data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </Button>
      </div>
    </section>
  );
}

