import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tags, X } from "lucide-react";
import { toast } from "sonner";
import { nativeConversationApi } from "@/hml/native-conversation-api";
import { db } from "@/hml/modules";
import { readPages } from "@/hml/unified-stages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Tag = { id: number; nome: string };
type Props = {
  companyId: number;
  contactId: number;
  leadId: number;
  name: string;
  actorId: string;
  canEdit: boolean;
};

export function ConversationLeadTags(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" aria-label="Tags do lead" onClick={() => setOpen(true)}>
        <Tags size={16} /> Tags
      </Button>
      {open && <TagDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

export function useConversationTagCatalog(
  companyId: number | null,
  actorId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["conversation-tag-catalog", companyId, actorId],
    enabled: enabled && !!companyId && !!actorId,
    queryFn: () =>
      readPages<Tag>((a, b) =>
        db
          .from("crm_tags")
          .select("id,nome")
          .eq("id_empresa", companyId!)
          .order("nome")
          .order("id")
          .range(a, b),
      ),
  });
}

function TagDialog({
  companyId,
  contactId,
  leadId,
  name,
  actorId,
  canEdit,
  onClose,
}: Props & { onClose: () => void }) {
  const [search, setSearch] = useState("");
  const client = useQueryClient();
  const tags = useQuery({
    queryKey: ["conversation-lead-tags", companyId, contactId, leadId, actorId],
    queryFn: async () => {
      const identity = await nativeConversationApi(db).context(companyId, contactId);
      if (identity.lead_id !== leadId) throw new Error("Esta conversa não corresponde ao lead.");
      const links = await readPages<{ tag_id: number }>((a, b) =>
        db
          .from("crm_lead_tags")
          .select("tag_id")
          .eq("lead_id", contactId)
          .order("tag_id")
          .range(a, b),
      );
      return links.map((link) => link.tag_id);
    },
  });
  const catalogQuery = useConversationTagCatalog(companyId, actorId, true);
  const catalog = catalogQuery.data ?? [];
  const linked = new Set(tags.data);
  const assigned = catalog.filter((tag) => linked.has(tag.id));
  const available = catalog.filter((tag) => !linked.has(tag.id));
  const attach = useMutation({
    mutationFn: async (tag: Tag | null) => {
      const { error } = await db.rpc("hub_add_conversation_lead_tag", {
        p_company: companyId,
        p_lead: leadId,
        p_contact: contactId,
        p_tag: tag?.id ?? null,
        p_name: tag ? null : search.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setSearch("");
      await client.invalidateQueries();
      toast.success("Tag adicionada ao lead");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: async (tag: Tag) => {
      const { error } = await db
        .from("crm_lead_tags")
        .delete()
        .eq("lead_id", contactId)
        .eq("tag_id", tag.id)
        .select("lead_id")
        .single();
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries();
      toast.success("Tag removida deste lead");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const busy = attach.isPending || remove.isPending;
  const term = search.trim().toLocaleLowerCase();
  const matches = available.filter((tag) => tag.nome.toLocaleLowerCase().includes(term)) ?? [];
  const exists = catalog.some((tag) => tag.nome.trim().toLocaleLowerCase() === term);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tags do lead</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        {tags.isPending || catalogQuery.isPending ? (
          <p role="status">Carregando tags…</p>
        ) : tags.isError || catalogQuery.isError ? (
          <Button
            variant="outline"
            onClick={() => {
              void tags.refetch();
              void catalogQuery.refetch();
            }}
          >
            Falha ao carregar. Tentar novamente
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {assigned.map((tag) => (
                <Badge variant="secondary" key={tag.id}>
                  {tag.nome}
                  {canEdit && (
                    <button
                      type="button"
                      className="ml-1 rounded p-1 hover:bg-muted-foreground/20 focus-visible:ring-2"
                      aria-label={`Remover ${tag.nome} deste lead`}
                      title={`Remover ${tag.nome} deste lead`}
                      disabled={busy}
                      onClick={() => remove.mutate(tag)}
                    >
                      <X size={14} />
                    </button>
                  )}
                </Badge>
              ))}
              {!assigned.length && (
                <p className="text-sm text-muted-foreground">Este lead ainda não tem tags.</p>
              )}
            </div>
            {canEdit && (
              <>
                <label className="block text-sm font-medium">
                  Adicionar tag
                  <Input
                    className="mt-1"
                    placeholder="Buscar ou criar tag"
                    maxLength={120}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                {term && !exists && (
                  <Button disabled={busy} onClick={() => attach.mutate(null)}>
                    Criar e adicionar “{search.trim()}”
                  </Button>
                )}
                <div className="max-h-60 overflow-y-auto">
                  {matches.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      disabled={busy}
                      className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => attach.mutate(tag)}
                    >
                      {tag.nome}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
