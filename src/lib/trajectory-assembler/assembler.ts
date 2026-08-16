import type {
  TrajectoryAssemblerPublication,
  TrajectoryAssemblerScheduler,
  TrajectoryEventV2,
  TrajectoryNodeDefinition,
  TrajectoryNodeMatch,
  TrajectoryNodeStateContext,
  TrajectoryPublication,
  TrajectoryViewBuilder,
  TrajectoryViewNode,
} from './types';

type StoredMatch = TrajectoryNodeMatch & {
  readonly arrival: number;
};

type InternalContext = {
  readonly definition: TrajectoryNodeDefinition<unknown, unknown>;
  readonly id: string;
  readonly key: string;
  readonly kind: string;
  readonly matches: StoredMatch[];
  lastAppliedSeq?: number;
  maxRecordedSeq?: number;
  node?: TrajectoryViewNode;
  start?: StoredMatch;
  state?: unknown;
};

type RegisteredView = {
  readonly builder: TrajectoryViewBuilder;
  snapshot: unknown;
};

const immediateScheduler: TrajectoryAssemblerScheduler = {
  request: (callback) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => callback());
      return;
    }
    setTimeout(callback, 0);
  },
};

function bySequence(left: StoredMatch, right: StoredMatch): number {
  return left.event.seq - right.event.seq || left.arrival - right.arrival;
}

function contextKey(kind: string, id: string): string {
  return `${kind.length}:${kind}${id}`;
}

/**
 * Deterministically turns B1 v2 lifecycle events into renderer-local node snapshots.
 * The append path only matches the new event and uses a Definition-local map lookup.
 */
export class TrajectoryAssembler {
  private readonly contexts = new Map<string, InternalContext>();
  private readonly definitions: readonly TrajectoryNodeDefinition<unknown, unknown>[];
  private readonly listeners = new Set<(publication: TrajectoryAssemblerPublication) => void>();
  private readonly nodes = new Map<string, TrajectoryViewNode>();
  private readonly pendingAnimationFrame = new Map<string, Map<string, TrajectoryViewNode>>();
  private readonly scheduler: TrajectoryAssemblerScheduler;
  private readonly views = new Map<string, RegisteredView>();
  private nextArrival = 0;
  private animationFrameRequested = false;

  constructor(
    definitions: readonly TrajectoryNodeDefinition<unknown, unknown>[],
    options: { scheduler?: TrajectoryAssemblerScheduler } = {},
  ) {
    const kinds = new Set<string>();
    for (const definition of definitions) {
      if (kinds.has(definition.kind)) {
        throw new Error(`Trajectory node definition kind must be unique: ${definition.kind}`);
      }
      kinds.add(definition.kind);
    }
    this.definitions = definitions;
    this.scheduler = options.scheduler ?? immediateScheduler;
  }

  append(event: TrajectoryEventV2): void {
    const changes = this.process(event, 'append');
    for (const change of changes) {
      this.publishApply(change.target, [change.node], change.publication);
    }
  }

  prepend(events: readonly TrajectoryEventV2[]): void {
    const changes = new Map<string, Map<string, TrajectoryViewNode>>();
    for (const event of this.sortEvents(events)) {
      for (const change of this.process(event, 'replay')) {
        const targetChanges = changes.get(change.target) ?? new Map<string, TrajectoryViewNode>();
        targetChanges.set(change.node.key, change.node);
        changes.set(change.target, targetChanges);
      }
    }
    for (const [target, upserts] of changes) {
      this.publishApply(target, [...upserts.values()], 'immediate');
    }
  }

  replace(events: readonly TrajectoryEventV2[]): void {
    this.animationFrameRequested = false;
    this.contexts.clear();
    this.nodes.clear();
    this.pendingAnimationFrame.clear();
    this.nextArrival = 0;

    for (const event of this.sortEvents(events)) {
      this.process(event, 'append');
    }

    for (const [target, view] of this.views) {
      const nodes = this.nodesForTarget(target);
      view.snapshot = view.builder.replace(nodes);
      this.emit({ mode: 'replace', target, upserts: nodes });
    }
  }

  getNode(key: string): TrajectoryViewNode | undefined {
    return this.nodes.get(key);
  }

  getNodes(): readonly TrajectoryViewNode[] {
    return [...this.nodes.values()].sort((left, right) => (
      left.anchorSeq - right.anchorSeq || left.key.localeCompare(right.key)
    ));
  }

  getPendingContextKeys(): readonly string[] {
    return [...this.contexts.values()]
      .filter((context) => context.start === undefined)
      .map((context) => context.key)
      .sort();
  }

  getViewSnapshot<Snapshot>(target: string): Snapshot | undefined {
    return this.views.get(target)?.snapshot as Snapshot | undefined;
  }

  registerView<Node extends TrajectoryViewNode, Snapshot>(
    target: string,
    builder: TrajectoryViewBuilder<Node, Snapshot>,
  ): Snapshot {
    if (this.views.has(target)) {
      throw new Error(`Trajectory view target is already registered: ${target}`);
    }
    const nodes = this.nodesForTarget(target) as readonly Node[];
    const snapshot = builder.replace(nodes);
    this.views.set(target, { builder, snapshot });
    return snapshot;
  }

  subscribe(listener: (publication: TrajectoryAssemblerPublication) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private contextState(context: InternalContext): TrajectoryNodeStateContext<unknown> {
    if (context.start === undefined || context.state === undefined) {
      throw new Error(`Cannot materialize pending trajectory context: ${context.key}`);
    }
    return {
      id: context.id,
      key: context.key,
      kind: context.kind,
      startSeq: context.start.event.seq,
      state: context.state,
    };
  }

  private emit(publication: TrajectoryAssemblerPublication): void {
    for (const listener of this.listeners) listener(publication);
  }

  private flushAnimationFrame(): void {
    this.animationFrameRequested = false;
    for (const [target, changes] of this.pendingAnimationFrame) {
      this.applyToView(target, [...changes.values()]);
    }
    this.pendingAnimationFrame.clear();
  }

  private nodesForTarget(target: string): readonly TrajectoryViewNode[] {
    return this.getNodes().filter((node) => node.target === target);
  }

  private process(event: TrajectoryEventV2, mode: 'append' | 'replay'): Array<{
    node: TrajectoryViewNode;
    publication: TrajectoryPublication;
    target: string;
  }> {
    const changes: Array<{
      node: TrajectoryViewNode;
      publication: TrajectoryPublication;
      target: string;
    }> = [];

    for (const definition of this.definitions) {
      const match = definition.match(event);
      if (match === null) continue;
      if (match.event !== event) {
        throw new Error(`Trajectory definition ${definition.kind} must return the supplied event`);
      }
      if (match.id.trim().length === 0) {
        throw new Error(`Trajectory definition ${definition.kind} returned an empty business id`);
      }

      const key = contextKey(definition.kind, match.id);
      const context = this.contexts.get(key) ?? {
        definition,
        id: match.id,
        key,
        kind: definition.kind,
        matches: [],
      };
      this.contexts.set(key, context);

      if (match.role === 'start' && context.start !== undefined) continue;
      const previousMaxSeq = context.maxRecordedSeq;
      const storedMatch: StoredMatch = { ...match, arrival: this.nextArrival++ };
      context.matches.push(storedMatch);
      context.maxRecordedSeq = Math.max(previousMaxSeq ?? 0, storedMatch.event.seq);
      if (match.role === 'start') context.start = storedMatch;

      const node = mode === 'replay'
        ? this.replayContext(context)
        : this.applyAppendedMatch(context, storedMatch, previousMaxSeq);
      if (node === undefined) continue;
      context.node = node;
      this.nodes.set(node.key, node);
      changes.push({
        node,
        publication: definition.publication?.(match) ?? 'immediate',
        target: node.target,
      });
    }

    return changes;
  }

  private publishApply(
    target: string,
    upserts: readonly TrajectoryViewNode[],
    publication: TrajectoryPublication,
  ): void {
    if (publication === 'none') return;
    if (publication === 'immediate') {
      this.applyToView(target, upserts);
      return;
    }

    const changes = this.pendingAnimationFrame.get(target) ?? new Map<string, TrajectoryViewNode>();
    for (const node of upserts) changes.set(node.key, node);
    this.pendingAnimationFrame.set(target, changes);
    if (this.animationFrameRequested) return;
    this.animationFrameRequested = true;
    this.scheduler.request(() => this.flushAnimationFrame());
  }

  private replayContext(context: InternalContext): TrajectoryViewNode | undefined {
    const start = context.start;
    if (start === undefined) return undefined;

    const matches = [...context.matches].sort(bySequence);
    let state = context.definition.start(start);
    let lastAppliedSeq = start.event.seq;
    for (const match of matches) {
      if (match === start || match.role !== 'update' || match.event.seq <= start.event.seq) continue;
      state = context.definition.update({
        id: context.id,
        key: context.key,
        kind: context.kind,
        startSeq: start.event.seq,
        state,
      }, match);
      lastAppliedSeq = match.event.seq;
    }
    context.state = state;
    context.lastAppliedSeq = lastAppliedSeq;
    return this.materializeContext(context);
  }

  private applyAppendedMatch(
    context: InternalContext,
    match: StoredMatch,
    previousMaxSeq: number | undefined,
  ): TrajectoryViewNode | undefined {
    if (match.role === 'start') {
      if (previousMaxSeq !== undefined && previousMaxSeq > match.event.seq) {
        throw new Error(`Append cannot activate an out-of-order trajectory context: ${context.key}`);
      }
      context.state = context.definition.start(match);
      context.lastAppliedSeq = match.event.seq;
      return this.materializeContext(context);
    }

    if (context.start === undefined || context.state === undefined) return undefined;
    if (match.event.seq <= (context.lastAppliedSeq ?? context.start.event.seq)) {
      throw new Error(`Append requires increasing sequence numbers for context: ${context.key}`);
    }
    context.state = context.definition.update(this.contextState(context), match);
    context.lastAppliedSeq = match.event.seq;
    return this.materializeContext(context);
  }

  private materializeContext(context: InternalContext): TrajectoryViewNode {
    return {
      anchorSeq: context.start!.event.seq,
      data: context.definition.buildData(this.contextState(context)),
      id: context.id,
      key: context.key,
      kind: context.kind,
      target: context.definition.target,
    };
  }

  private applyToView(target: string, upserts: readonly TrajectoryViewNode[]): void {
    const view = this.views.get(target);
    if (view !== undefined) view.snapshot = view.builder.apply(upserts);
    this.emit({ mode: 'apply', target, upserts });
  }

  private sortEvents(events: readonly TrajectoryEventV2[]): readonly TrajectoryEventV2[] {
    return events
      .map((event, index) => ({ event, index }))
      .sort((left, right) => left.event.seq - right.event.seq || left.index - right.index)
      .map(({ event }) => event);
  }
}
