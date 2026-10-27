import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LockKeyhole, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ConfigSection } from "@/components/config-presentation";
import { useCrmUser } from "@/hooks/use-crm-user";
import { db, inputClass, useCompanyModules } from "@/hml/modules";
import { saveCommercialTag } from "@/lib/commercial-tags.functions";

type Tag = {
  id: number;
  nome: string;
  cor: string;
  descricao: string;
  ativo: boolean;
  revision: number;
  uses: number;
};
const colors = [
  "#C14F21",
  "#F59E0B",
  "#A88600",
  "#16A34A",
  "#2563EB",
  "#8B5CF6",
  "#EF4444",
  "#64748B",
  "#111827",
];
function useTags(companyId: number, enabled = true) {
  const { data: me } = useCrmUser();
  return useQuery({
    queryKey: ["commercial-tags", companyId, me?.id],
    enabled: enabled && !!me,
    queryFn: async () => {
      const { data, error } = await db.rpc("hub_commercial_tags", { p_company_id: companyId });
      if (error)
        throw new Error(
          ["42883", "PGRST202"].includes(error.code)
            ? "Tags comerciais ainda não instaladas neste ambiente."
            : error.message,
        );
      return data as Tag[];
    },
  });
}
export function CompanyTags({ companyId }: { companyId: number }) {
  const { data: modules } = useCompanyModules();
  const { data: me } = useCrmUser();
  const canManage = me?.active && ["manager", "super_admin"].includes(me.role);
  const tags = useTags(companyId, !!modules?.crm);
  const system = useQuery({
    queryKey: ["system-tags", companyId, me?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("crm_tags")
        .select("id,nome,cor")
        .eq("id_empresa", companyId)
        .order("nome");
      if (error) throw error;
      return data as { id: number; nome: string; cor: string }[];
    },
  });
  const qc = useQueryClient();
  const save = useServerFn(saveCommercialTag);
  const [editing, setEditing] = useState<Partial<Tag> | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!editing || !canManage) throw new Error("Acesso restrito ao gestor");
      return save({
        data: {
          companyId,
          id: editing.id ?? null,
          revision: editing.revision ?? null,
          nome: editing.nome ?? "",
          cor: editing.cor ?? colors[0],
          descricao: editing.descricao ?? "",
          ativo: editing.ativo ?? true,
        },
      });
    },
    onSuccess: async () => {
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["commercial-tags", companyId] });
      toast.success("Tag comercial salva");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-6">
      {modules?.crm && (
        <ConfigSection>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Tags da empresa</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Criadas pelo gestor. Corretores aplicam nas oportunidades do CRM comercial.
              </p>
            </div>
            {canManage && (
              <Button
                onClick={() => setEditing({ nome: "", cor: colors[0], descricao: "", ativo: true })}
              >
                <Plus />
                Nova tag
              </Button>
            )}
          </div>
          {tags.isPending ? (
            <p>Carregando tags…</p>
          ) : tags.isError ? (
            <p role="alert">
              {tags.error.message}{" "}
              <Button variant="outline" onClick={() => tags.refetch()}>
                Tentar novamente
              </Button>
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="p-3">Tag</th>
                    <th className="p-3">Uso</th>
                    <th className="p-3">Oportunidades</th>
                    <th className="p-3">Situação</th>
                    {canManage && <th className="p-3">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {tags.data.map((tag) => (
                    <tr key={tag.id} className="border-b">
                      <td className="p-3">
                        <TagName tag={tag} />
                      </td>
                      <td className="p-3">{tag.descricao || "—"}</td>
                      <td className="p-3">{tag.uses}</td>
                      <td className="p-3">{tag.ativo ? "Ativa" : "Arquivada"}</td>
                      {canManage && (
                        <td className="p-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Editar tag ${tag.nome}`}
                            onClick={() => setEditing(tag)}
                          >
                            <Pencil />
                            Editar
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!tags.data.length && (
                <p className="p-4 text-sm text-muted-foreground">
                  Nenhuma tag comercial cadastrada.
                </p>
              )}
            </div>
          )}
        </ConfigSection>
      )}
      <ConfigSection>
        <h2 className="font-semibold">Tags do sistema (IA)</h2>
        <p className="text-sm text-muted-foreground">
          Aplicadas pelas automações do atendimento IA. Não podem ser alteradas manualmente nos
          leads.
        </p>
        {system.isPending ? (
          <p>Carregando…</p>
        ) : system.isError ? (
          <p role="alert">
            Não foi possível carregar as tags IA.{" "}
            <Button variant="outline" onClick={() => system.refetch()}>
              Tentar novamente
            </Button>
          </p>
        ) : (
          <div className="divide-y">
            {system.data.map((tag) => (
              <div key={tag.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <TagName tag={tag} />
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <LockKeyhole className="size-3" />
                  Automática · somente leitura
                </span>
              </div>
            ))}
            {!system.data.length && (
              <p className="text-sm text-muted-foreground">Nenhuma tag IA cadastrada.</p>
            )}
          </div>
        )}
      </ConfigSection>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setEditing(null);
        }}
      >
        <DialogContent className="config-dialog">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Editar tag" : "Nova tag"}</DialogTitle>
            <DialogDescription>Disponível apenas no CRM comercial desta empresa.</DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="config-form space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                mutation.mutate();
              }}
            >
              <label className="block text-sm">
                Nome
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  className={inputClass}
                  disabled={mutation.isPending}
                  value={editing.nome}
                  onChange={(e) => setEditing({ ...editing, nome: e.target.value })}
                />
              </label>
              <fieldset disabled={mutation.isPending}>
                <legend className="mb-2 text-sm">Cor</legend>
                <div className="flex flex-wrap gap-2">
                  {colors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Cor ${color}`}
                      aria-pressed={editing.cor === color}
                      onClick={() => setEditing({ ...editing, cor: color })}
                      className="size-7 rounded-md border-2 border-white ring-1 ring-border aria-pressed:ring-2 aria-pressed:ring-primary focus-visible:outline-2"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </fieldset>
              <label className="block text-sm">
                Uso (opcional)
                <input
                  maxLength={300}
                  className={inputClass}
                  disabled={mutation.isPending}
                  placeholder="Quando aplicar esta tag"
                  value={editing.descricao}
                  onChange={(e) => setEditing({ ...editing, descricao: e.target.value })}
                />
              </label>
              {editing.id && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editing.ativo}
                    disabled={mutation.isPending}
                    onChange={(e) => setEditing({ ...editing, ativo: e.target.checked })}
                  />
                  <span>
                    Tag ativa
                    <span className="block text-xs text-muted-foreground">
                      Arquivar impede novas aplicações e preserva as marcações existentes.
                    </span>
                  </span>
                </label>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => setEditing(null)}
                >
                  Cancelar
                </Button>
                <Button disabled={mutation.isPending}>
                  {mutation.isPending ? "Salvando…" : "Salvar tag"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function TagName({ tag }: { tag: { nome: string; cor: string } }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: tag.cor }}
      />
      {tag.nome}
    </span>
  );
}
export function OpportunityTags({
  companyId,
  opportunityId,
}: {
  companyId: number;
  opportunityId: string;
}) {
  const tags = useTags(companyId);
  const { data: me } = useCrmUser();
  const qc = useQueryClient();
  const key = ["opportunity-tags", companyId, opportunityId, me?.id];
  const applied = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db
        .from("crm_opportunity_tags")
        .select("tag_id")
        .eq("id_empresa", companyId)
        .eq("opportunity_id", opportunityId);
      if (error) throw error;
      return new Set<number>(data.map((row) => row.tag_id));
    },
  });
  const mutation = useMutation({
    mutationFn: async ({ id, value }: { id: number; value: boolean }) => {
      const { error } = await db.rpc("hub_set_opportunity_tag", {
        p_opportunity: opportunityId,
        p_tag: id,
        p_applied: value,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: key }),
        qc.invalidateQueries({ queryKey: ["commercial-tags", companyId] }),
      ]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">Tags comerciais</h3>
      <p className="text-xs text-muted-foreground">
        Marque ou desmarque as tags desta oportunidade.
      </p>
      {tags.isPending || applied.isPending ? (
        <p className="text-sm">Carregando…</p>
      ) : tags.isError || applied.isError ? (
        <div role="alert" className="text-sm">
          Não foi possível carregar as tags.{" "}
          <Button
            variant="outline"
            onClick={() => {
              void tags.refetch();
              void applied.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.data
            .filter((t) => t.ativo || applied.data.has(t.id))
            .map((tag) => (
              <label
                key={tag.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={applied.data.has(tag.id)}
                  disabled={mutation.isPending}
                  onChange={(e) => mutation.mutate({ id: tag.id, value: e.target.checked })}
                />
                <TagName tag={tag} />
                {!tag.ativo && <span className="text-xs text-muted-foreground">Arquivada</span>}
              </label>
            ))}
          {!tags.data.some((t) => t.ativo || applied.data.has(t.id)) && (
            <p className="text-sm text-muted-foreground">
              O gestor ainda não cadastrou tags comerciais ativas.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
