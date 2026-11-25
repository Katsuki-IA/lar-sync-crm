import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tags } from "lucide-react";
import { toast } from "sonner";
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
    queryKey: ["conversation-lead-tags", companyId, contactId, actorId],
    queryFn: async () => {
      const [catalog, links] = await Promise.all([
        readPages<Tag>((a, b) =>
          db
            .from("crm_tags")
            .select("id,nome")
            .eq("id_empresa", companyId)
            .order("nome")
            .order("id")
            .range(a, b),
        ),
        readPages<{ tag_id: number }>((a, b) =>
          db
            .from("crm_lead_tags")
            .select("tag_id")
            .eq("lead_id", contactId)
            .order("tag_id")
            .range(a, b),
        ),
      ]);
      const linked = new Set(links.map((l) => l.tag_id));
      return {
        assigned: catalog.filter((t) => linked.has(t.id)),
        available: catalog.filter((t) => !linked.has(t.id)),
        catalog,
      };
    },
  });
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
  const term = search.trim().toLocaleLowerCase();
  const matches =
    tags.data?.available.filter((tag) => tag.nome.toLocaleLowerCase().includes(term)) ?? [];
  const exists = tags.data?.catalog.some((tag) => tag.nome.trim().toLocaleLowerCase() === term);
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
        {tags.isPending ? (
          <p role="status">Carregando tags…</p>
        ) : tags.isError ? (
          <Button variant="outline" onClick={() => tags.refetch()}>
            Falha ao carregar. Tentar novamente
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {tags.data.assigned.map((tag) => (
                <Badge variant="secondary" key={tag.id}>
                  {tag.nome}
                </Badge>
              ))}
              {!tags.data.assigned.length && (
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
                  <Button disabled={attach.isPending} onClick={() => attach.mutate(null)}>
                    Criar e adicionar “{search.trim()}”
                  </Button>
                )}
                <div className="max-h-60 overflow-y-auto">
                  {matches.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      disabled={attach.isPending}
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
