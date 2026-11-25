import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Link } from "@tanstack/react-router";
import { GripVertical } from "lucide-react";
import { inputClass, type Contact, type Funnel, type Stage } from "@/hml/modules";

type MoveProps = {
  draggable: boolean;
  targets: Stage[];
  funnels: Funnel[];
  onMove: (contact: Contact, stage: Stage) => void;
};

export function AttendanceColumn({
  stage,
  funnelName,
  contacts,
  ...moves
}: MoveProps & { stage?: Stage; funnelName?: string; contacts: Contact[] }) {
  const [limit, setLimit] = useState(40);
  const { setNodeRef, isOver } = useDroppable({ id: stage?.id ?? "unassigned", disabled: !stage });
  return (
    <section
      ref={setNodeRef}
      className={`w-64 shrink-0 rounded-xl border bg-muted ${isOver ? "ring-2 ring-primary" : ""}`}
    >
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        Atendimento{funnelName && " · " + funnelName}
      </p>
      <header className="flex items-center justify-between border-b p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="h-2 w-2 rounded-full" style={{ background: stage?.cor }} />
          {stage?.nome ?? "Sem etapa ativa"}
        </h2>
        <span className="text-xs">{contacts.length}</span>
      </header>
      <div className="min-h-52 space-y-3 p-3">
        {contacts.slice(0, limit).map((contact) => (
          <AttendanceCard key={contact.id} contact={contact} current={stage?.id} {...moves} />
        ))}
        {contacts.length > limit && (
          <button className="w-full text-sm text-primary" onClick={() => setLimit(limit + 40)}>
            Mostrar mais leads
          </button>
        )}
        {!contacts.length && (
          <p className="py-8 text-center text-xs text-muted-foreground">Sem leads nesta etapa</p>
        )}
      </div>
    </section>
  );
}

function AttendanceCard({
  contact,
  current,
  draggable,
  targets,
  funnels,
  onMove,
}: MoveProps & { contact: Contact; current?: number }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: "lead-" + contact.id,
    disabled: !draggable,
  });
  return (
    <article
      ref={setNodeRef}
      className="relative space-y-2 rounded-lg border bg-card p-3"
      style={
        transform
          ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)`, zIndex: 10 }
          : undefined
      }
    >
      <div className="flex items-start gap-2">
        {draggable && (
          <button {...attributes} {...listeners} aria-label="Arrastar lead" className="touch-none">
            <GripVertical size={16} />
          </button>
        )}
        <Link
          className="text-sm font-semibold hover:underline"
          to="/leads/$id"
          params={{ id: String(contact.id) }}
        >
          {contact.nome || "Lead #" + contact.id}
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">{contact.telefone}</p>
      {targets.length > 0 && (
        <select
          className={inputClass}
          aria-label="Mover para etapa"
          value=""
          disabled={!draggable}
          onChange={(e) => {
            const target = targets.find((s) => s.id === Number(e.target.value));
            if (target) onMove(contact, target);
          }}
        >
          <option value="">Mover para etapa</option>
          {funnels.map(
            (f) =>
              targets.some((s) => s.id_funnel === f.id) && (
                <optgroup
                  key={f.id}
                  label={(f.module === "ia" ? "Atendimento" : "Vendas") + " · " + f.nome}
                >
                  {targets
                    .filter((s) => s.id_funnel === f.id)
                    .map((s) => (
                      <option disabled={s.id === current} key={s.id} value={s.id}>
                        {s.nome}
                      </option>
                    ))}
                </optgroup>
              ),
          )}
        </select>
      )}
    </article>
  );
}
