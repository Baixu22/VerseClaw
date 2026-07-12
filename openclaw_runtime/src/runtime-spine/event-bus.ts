// @runtime-family v1.0
// @authority diagnostic_only
// @owner WP1

import { randomUUID } from 'node:crypto';

import { shadowSafetyBoundary } from './shadow-safety-boundary-adapter.js';
import type {
  EventSource,
  LifecycleEntityType,
  RuntimeEvent,
  RuntimeEventKind,
  RuntimeSpineRef,
} from './types.js';

type RuntimeEventHandler = (event: RuntimeEvent) => void | Promise<void>;
type RuntimeEventPersistenceAdapter = (event: RuntimeEvent) => void | Promise<void>;

const MAX_BUFFER_SIZE = 2000;

class EventBus {
  private readonly handlers = new Map<RuntimeEventKind | '*', Set<RuntimeEventHandler>>();
  private readonly buffer: RuntimeEvent[] = [];
  private persistenceAdapter?: RuntimeEventPersistenceAdapter;

  emit(
    kind: RuntimeEventKind,
    entityId: string,
    entityType: LifecycleEntityType,
    source: EventSource,
    payload?: unknown,
    refs?: RuntimeSpineRef[],
  ): RuntimeEvent {
    const event: RuntimeEvent = {
      eventId: randomUUID(),
      kind,
      entityId,
      entityType,
      source,
      payload,
      refs,
      timestamp: Date.now(),
    };

    shadowSafetyBoundary.execute('event-bus.emit.buffer', () => {
      this.buffer.push(event);
      while (this.buffer.length > MAX_BUFFER_SIZE) {
        this.buffer.shift();
      }
    });

    void this.dispatch(event);
    void this.persist(event);
    return event;
  }

  on(kind: RuntimeEventKind | '*', handler: RuntimeEventHandler): () => void {
    const handlers = this.handlers.get(kind) ?? new Set<RuntimeEventHandler>();
    handlers.add(handler);
    this.handlers.set(kind, handlers);
    return () => {
      handlers.delete(handler);
    };
  }

  getBuffer(): RuntimeEvent[] {
    return this.buffer.slice();
  }

  getByEntity(entityId: string): RuntimeEvent[] {
    return this.buffer.filter((event) => event.entityId === entityId);
  }

  clear(): void {
    shadowSafetyBoundary.execute('event-bus.clear', () => {
      this.buffer.length = 0;
    });
  }

  setPersistenceAdapter(adapter?: RuntimeEventPersistenceAdapter): void {
    shadowSafetyBoundary.execute('event-bus.set-persistence-adapter', () => {
      this.persistenceAdapter = adapter;
    });
  }

  private async dispatch(event: RuntimeEvent): Promise<void> {
    const handlers = [
      ...(this.handlers.get(event.kind) ?? []),
      ...(this.handlers.get('*') ?? []),
    ];

    for (const handler of handlers) {
      await shadowSafetyBoundary.executeAsync('event-bus.handler', async () => {
        await handler(event);
      });
    }
  }

  private async persist(event: RuntimeEvent): Promise<void> {
    const adapter = this.persistenceAdapter;
    if (!adapter) {
      return;
    }

    await shadowSafetyBoundary.executeAsync('event-bus.persistence', async () => {
      await adapter(event);
    });
  }
}

export const eventBus = new EventBus();
