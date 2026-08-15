import { describe, expect, it } from 'vitest';
import {
  TrajectoryAssembler,
  type TrajectoryAssemblerScheduler,
  type TrajectoryEventV2,
  type TrajectoryNodeDefinition,
  type TrajectoryViewBuilder,
  type TrajectoryViewNode,
} from '../../src/lib/trajectory-assembler';

type ToolData = {
  readonly output?: string;
  readonly status: string;
};

type ToolSnapshot = {
  readonly output?: string;
  readonly status: string;
};

function toolEvent(
  seq: number,
  phase: 'start' | 'update' | 'end',
  state: ToolSnapshot,
  toolCallId = 'tool-1',
): TrajectoryEventV2 {
  return {
    traceSchema: 'openclaw-trajectory',
    schemaVersion: 2,
    traceId: 'trace-1',
    source: 'runtime',
    ts: `2026-08-15T00:00:0${seq}.000Z`,
    seq,
    type: phase === 'start' ? 'tool/start' : phase === 'update' ? 'tool/update' : 'tool/end',
    role: 'tool',
    phase,
    runId: 'run-1',
    turnId: 'turn-1',
    stepId: 'step-1',
    toolCallId,
    state,
  };
}

function toolDefinition(options: {
  publication?: (event: TrajectoryEventV2) => 'animation-frame' | 'immediate' | 'none';
  onMatch?: () => void;
} = {}): TrajectoryNodeDefinition<ToolSnapshot, ToolData> {
  return {
    kind: 'tool-call',
    target: 'tools',
    match: (event) => {
      options.onMatch?.();
      if (event.role !== 'tool') return null;
      return {
        event,
        id: event.toolCallId,
        role: event.phase === 'start' ? 'start' : 'update',
      };
    },
    start: (match) => match.event.state as ToolSnapshot,
    update: (_context, match) => match.event.state as ToolSnapshot,
    buildData: (context) => ({ ...context.state }),
    publication: (match) => options.publication?.(match.event) ?? 'immediate',
  };
}

class ToolView implements TrajectoryViewBuilder<TrajectoryViewNode<ToolData>, ReadonlyMap<string, ToolData>> {
  snapshot = new Map<string, ToolData>();
  replaceCalls = 0;
  applyCalls = 0;

  replace(nodes: readonly TrajectoryViewNode<ToolData>[]): ReadonlyMap<string, ToolData> {
    this.replaceCalls += 1;
    this.snapshot = new Map(nodes.map((node) => [node.key, node.data]));
    return this.snapshot;
  }

  apply(upserts: readonly TrajectoryViewNode<ToolData>[]): ReadonlyMap<string, ToolData> {
    this.applyCalls += 1;
    for (const node of upserts) this.snapshot.set(node.key, node.data);
    return this.snapshot;
  }
}

function nodeFor(assembler: TrajectoryAssembler, id = 'tool-1'): TrajectoryViewNode<ToolData> {
  const node = assembler.getNodes().find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error(`Missing tool node: ${id}`);
  return node as TrajectoryViewNode<ToolData>;
}

describe('TrajectoryAssembler', () => {
  it('replaces an event window with the expected terminal whole-value state', () => {
    let matchCalls = 0;
    const assembler = new TrajectoryAssembler([toolDefinition({ onMatch: () => matchCalls += 1 })]);
    const view = new ToolView();
    assembler.registerView('tools', view);

    assembler.replace([
      toolEvent(1, 'start', { status: 'running' }),
      toolEvent(2, 'update', { status: 'running', output: 'partial' }),
      toolEvent(3, 'end', { status: 'completed', output: 'done' }),
    ]);

    expect(nodeFor(assembler).data).toEqual({ status: 'completed', output: 'done' });
    expect(view.snapshot.get(nodeFor(assembler).key)).toEqual({ status: 'completed', output: 'done' });
    expect(view.replaceCalls).toBe(2);
    expect(matchCalls).toBe(3);
  });

  it('keeps an update-only tail pending until prepend supplies its start, then equals replace', () => {
    const tail = [
      toolEvent(2, 'update', { status: 'running', output: 'partial' }),
      toolEvent(3, 'end', { status: 'completed', output: 'done' }),
    ];
    const start = toolEvent(1, 'start', { status: 'running' });
    const paged = new TrajectoryAssembler([toolDefinition()]);
    const replacement = new TrajectoryAssembler([toolDefinition()]);

    for (const event of tail) paged.append(event);
    expect(paged.getNodes()).toEqual([]);
    expect(paged.getPendingContextKeys()).toHaveLength(1);

    paged.prepend([start]);
    replacement.replace([start, ...tail]);

    expect(paged.getNodes()).toEqual(replacement.getNodes());
    expect(paged.getPendingContextKeys()).toEqual([]);
  });

  it('makes historical prepend plus live append equivalent to a full replay', () => {
    const start = toolEvent(1, 'start', { status: 'running' });
    const partial = toolEvent(2, 'update', { status: 'running', output: 'partial' });
    const complete = toolEvent(3, 'end', { status: 'completed', output: 'done' });
    const paged = new TrajectoryAssembler([toolDefinition()]);
    const replacement = new TrajectoryAssembler([toolDefinition()]);

    paged.append(partial);
    paged.prepend([start]);
    paged.append(complete);
    replacement.replace([start, partial, complete]);

    expect(paged.getNodes()).toEqual(replacement.getNodes());
  });

  it('preserves unchanged keyed node references while prepending historical contexts', () => {
    const assembler = new TrajectoryAssembler([toolDefinition()]);
    assembler.replace([
      toolEvent(3, 'start', { status: 'running' }, 'tool-stable'),
      toolEvent(4, 'end', { status: 'completed', output: 'stable' }, 'tool-stable'),
      toolEvent(6, 'update', { status: 'running', output: 'partial' }, 'tool-pending'),
    ]);
    const stableBefore = nodeFor(assembler, 'tool-stable');

    assembler.prepend([
      toolEvent(1, 'start', { status: 'running' }, 'tool-pending'),
      toolEvent(2, 'update', { status: 'running', output: 'older' }, 'tool-pending'),
    ]);

    expect(nodeFor(assembler, 'tool-stable')).toBe(stableBefore);
    expect(nodeFor(assembler, 'tool-pending').data).toEqual({ status: 'running', output: 'partial' });
  });

  it('publishes animation-frame updates at most once per frame', () => {
    const callbacks: Array<() => void> = [];
    const scheduler: TrajectoryAssemblerScheduler = { request: (callback) => callbacks.push(callback) };
    const assembler = new TrajectoryAssembler([
      toolDefinition({
        publication: (event) => event.phase === 'update' ? 'animation-frame' : 'immediate',
      }),
    ], { scheduler });
    const view = new ToolView();
    const publications: string[] = [];
    assembler.registerView('tools', view);
    assembler.subscribe((publication) => publications.push(publication.mode));

    assembler.append(toolEvent(1, 'start', { status: 'running' }));
    assembler.append(toolEvent(2, 'update', { status: 'running', output: 'first' }));
    assembler.append(toolEvent(3, 'update', { status: 'running', output: 'second' }));

    expect(callbacks).toHaveLength(1);
    expect(publications).toEqual(['apply']);
    callbacks[0]!();
    expect(publications).toEqual(['apply', 'apply']);
    expect(view.applyCalls).toBe(2);
    expect(view.snapshot.get(nodeFor(assembler).key)).toEqual({ status: 'running', output: 'second' });
  });

  it('gives renderer-facing consumers node.data without event or context internals', () => {
    const assembler = new TrajectoryAssembler([toolDefinition()]);
    assembler.replace([toolEvent(1, 'start', { status: 'running', output: 'visible' })]);
    const node = nodeFor(assembler);

    const render = (viewNode: TrajectoryViewNode<ToolData>): string => viewNode.data.output ?? viewNode.data.status;

    expect(render(node)).toBe('visible');
    expect(node).not.toHaveProperty('state');
    expect(node).not.toHaveProperty('matches');
    expect(node).not.toHaveProperty('event');
  });
});
