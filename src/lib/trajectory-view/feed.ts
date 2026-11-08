import type { ObservabilityTrajectoryHistoryPage, ObservabilityTrajectorySupplyEvent } from '@shared/types/observability';
import { TrajectoryAssembler, type TrajectoryEventV2, type TrajectoryViewNode } from '../trajectory-assembler';
import { lifecycleDefinitions, type LifecycleData } from './lifecycle';

export type TrajectoryView = {
  sessionKey: string;
  nodes: readonly TrajectoryViewNode<LifecycleData>[];
  lastSeq: number;
  legacyFallback: boolean;
  loading: boolean;
  error: boolean;
};
type Listener = (view: TrajectoryView) => void;
type Session = {
  assembler: TrajectoryAssembler;
  listeners: Set<Listener>;
  buffer: Map<number, TrajectoryEventV2>;
  lastSeq: number;
  hydrated: boolean;
  legacyFallback: boolean;
  error: boolean;
  loading: Promise<void> | null;
  pendingRefresh: boolean;
};
type Sources = {
  history: (input: { sessionKey: string; fromSeq: number; limit: number }) => Promise<ObservabilityTrajectoryHistoryPage<TrajectoryEventV2>>;
  subscribe: (listener: (batch: ObservabilityTrajectorySupplyEvent<TrajectoryEventV2>) => void) => () => void;
};

export class TrajectoryViewFeed {
  private readonly sessions = new Map<string, Session>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly sources: Sources) {}

  connect(sessionKey: string, listener: Listener): () => void {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = { assembler: new TrajectoryAssembler(lifecycleDefinitions), listeners: new Set(), buffer: new Map(),
        lastSeq: 0, hydrated: false, legacyFallback: false, error: false, loading: null, pendingRefresh: false };
      this.sessions.set(sessionKey, session);
    }
    session.listeners.add(listener);
    this.unsubscribe ??= this.sources.subscribe((batch) => this.receive(batch));
    this.publish(sessionKey, session);
    void this.refresh(sessionKey);
    return () => {
      session.listeners.delete(listener);
      if (session.listeners.size === 0) this.sessions.delete(sessionKey);
      if (this.sessions.size === 0) { this.unsubscribe?.(); this.unsubscribe = null; }
    };
  }

  refresh(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) return Promise.resolve();
    if (session.loading) return session.loading;
    const active = () => this.sessions.get(sessionKey) === session;
    session.pendingRefresh = false;
    session.loading = Promise.resolve().then(async () => {
      try {
        let cursor = session.lastSeq;
        let hasMore: boolean;
        do {
          const page = await this.sources.history({ sessionKey, fromSeq: cursor, limit: 200 });
          if (!active()) return;
          if (page.sessionKey !== sessionKey || page.schemaVersion !== 2 || page.fromSeq !== cursor) {
            throw new Error('Trajectory history scope mismatch');
          }
          session.legacyFallback = page.legacyFallback;
          for (const event of page.events) if (event.seq > session.lastSeq) session.buffer.set(event.seq, event);
          this.drain(session, !session.hydrated && cursor === 0 ? page.events[0]?.seq : undefined);
          hasMore = page.hasMore;
          if (hasMore && page.asOfSeq <= cursor) throw new Error('Trajectory pagination did not advance');
          cursor = page.asOfSeq;
        } while (hasMore);
        session.hydrated = true;
        this.drain(session);
        session.error = session.buffer.size > 0;
      } catch {
        if (active()) session.error = true;
      } finally {
        session.loading = null;
        if (active()) this.publish(sessionKey, session);
        if (active() && session.pendingRefresh && session.buffer.size > 0) void this.refresh(sessionKey);
      }
    });
    return session.loading;
  }

  private receive(batch: ObservabilityTrajectorySupplyEvent<TrajectoryEventV2>): void {
    const session = this.sessions.get(batch.sessionKey);
    if (!session || batch.schemaVersion !== 2) return;
    for (const event of batch.events) if (event.seq > session.lastSeq) session.buffer.set(event.seq, event);
    if (!session.hydrated || session.loading) { session.pendingRefresh = true; return; }
    this.drain(session);
    this.publish(batch.sessionKey, session);
    if (session.buffer.size) void this.refresh(batch.sessionKey);
  }

  private drain(session: Session, retainedStart?: number): void {
    for (const [seq, event] of [...session.buffer.entries()].sort(([a], [b]) => a - b)) {
      if (seq <= session.lastSeq) { session.buffer.delete(seq); continue; }
      if (seq !== session.lastSeq + 1 && !(seq === retainedStart && session.lastSeq === 0)) break;
      session.assembler.append(event);
      session.lastSeq = seq;
      session.buffer.delete(seq);
    }
  }

  private publish(sessionKey: string, session: Session): void {
    const view: TrajectoryView = { sessionKey, nodes: session.assembler.getNodes() as readonly TrajectoryViewNode<LifecycleData>[],
      lastSeq: session.lastSeq, legacyFallback: session.legacyFallback, loading: session.loading !== null, error: session.error };
    for (const listener of session.listeners) listener(view);
  }
}
