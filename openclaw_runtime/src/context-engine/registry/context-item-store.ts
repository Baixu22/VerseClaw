import type {
  ContextItem,
  ContextItemId,
  ContextItemKind,
  LifecycleEvent,
  LifecycleState,
} from '../../../../shared/types/context-family.js';

export type ContextItemQuery = {
  sessionId?: string;
  kind?: ContextItemKind;
  lifecycleState?: LifecycleState;
};

export interface ContextItemStore {
  upsertItem(item: ContextItem): Promise<void>;
  appendLifecycleEvent(event: LifecycleEvent): Promise<void>;
  getItem(id: ContextItemId): Promise<ContextItem | undefined>;
  queryItems(query?: ContextItemQuery): Promise<ContextItem[]>;
}

export type ContextItemStoreDump = {
  items: ContextItem[];
  lifecycleEvents: LifecycleEvent[];
};

export class InMemoryContextItemStore implements ContextItemStore {
  readonly #items = new Map<ContextItemId, ContextItem>();
  readonly #events: LifecycleEvent[] = [];

  async upsertItem(item: ContextItem): Promise<void> {
    this.#items.set(item.id, structuredClone(item));
  }

  async appendLifecycleEvent(event: LifecycleEvent): Promise<void> {
    this.#events.push(structuredClone(event));
    const current = this.#items.get(event.itemId);
    if (current) {
      this.#items.set(event.itemId, structuredClone({
        ...current,
        lifecycleState: event.to,
      }));
    }
  }

  async getItem(id: ContextItemId): Promise<ContextItem | undefined> {
    const item = this.#items.get(id);
    return item ? structuredClone(item) : undefined;
  }

  async queryItems(query: ContextItemQuery = {}): Promise<ContextItem[]> {
    return [...this.#items.values()]
      .filter((item) => {
        if (query.sessionId && item.source.sessionId !== query.sessionId) {
          return false;
        }
        if (query.kind && item.kind !== query.kind) {
          return false;
        }
        if (query.lifecycleState && item.lifecycleState !== query.lifecycleState) {
          return false;
        }
        return true;
      })
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => structuredClone(item));
  }

  async dump(): Promise<ContextItemStoreDump> {
    return {
      items: await this.queryItems(),
      lifecycleEvents: this.#events.map((event) => structuredClone(event)),
    };
  }
}
