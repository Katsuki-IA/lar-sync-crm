import { Component, createRef, type ReactNode } from "react";
import { parseDateValue } from "./conversation-message-content";

type ConversationRow = { lead_id: number; last_message_at: string | null };
export type ConversationOrder = "recent" | "oldest";

export function orderConversations<T extends ConversationRow>(
  rows: T[],
  order: ConversationOrder,
): T[] {
  const direction = order === "oldest" ? 1 : -1;
  return rows
    .map((row) => {
      const date = parseDateValue(row.last_message_at);
      return { row, time: date instanceof Date ? date.getTime() : null };
    })
    .sort((a, b) => {
      if (a.time === null && b.time !== null) return 1;
      if (b.time === null && a.time !== null) return -1;
      return direction * ((a.time ?? 0) - (b.time ?? 0) || a.row.lead_id - b.row.lead_id);
    })
    .map((entry) => entry.row);
}

type Props = { rows: ConversationRow[]; order: ConversationOrder; children: ReactNode };
type Anchor = { row: HTMLElement; offset: number };

// Measure against the old DOM before React moves the sent conversation to the end.
export class ConversationListViewport extends Component<
  Props,
  Record<string, never>,
  Anchor | null
> {
  private list = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate(previous: Props): Anchor | null {
    const list = this.list.current;
    if (
      !list ||
      !list.clientHeight ||
      this.props.order !== "oldest" ||
      previous.order !== this.props.order ||
      previous.rows === this.props.rows ||
      previous.rows.every((row, i) => this.props.rows[i]?.lead_id === row.lead_id)
    )
      return null;
    const currentTimes = new Map(this.props.rows.map((row) => [row.lead_id, row.last_message_at]));
    const bounds = list.getBoundingClientRect();
    for (const element of list.querySelectorAll<HTMLElement>("[data-conversation-row]")) {
      const old = previous.rows[Number(element.dataset.conversationRow)];
      if (!old || currentTimes.get(old.lead_id) !== old.last_message_at) continue;
      const rect = element.getBoundingClientRect();
      if (rect.top >= bounds.bottom) break;
      if (rect.bottom > bounds.top) return { row: element, offset: rect.top - bounds.top };
    }
    return null;
  }

  componentDidUpdate(previous: Props, _state: Record<string, never>, anchor: Anchor | null) {
    const list = this.list.current;
    if (!list) return;
    if (previous.order !== this.props.order) list.scrollTop = 0;
    else if (anchor && list.contains(anchor.row)) {
      list.scrollTop +=
        anchor.row.getBoundingClientRect().top - list.getBoundingClientRect().top - anchor.offset;
    }
  }

  render() {
    return (
      <div
        ref={this.list}
        style={{ overflowAnchor: this.props.order === "oldest" ? "none" : undefined }}
        className="h-[calc(100dvh-22rem)] min-h-[280px] overflow-y-auto lg:h-[calc(100dvh-230px)]"
      >
        {this.props.children}
      </div>
    );
  }
}
