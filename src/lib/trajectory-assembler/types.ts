import type { TrajectoryEventV2 } from '../../../openclaw_runtime/src/trajectory/types';

export type { TrajectoryEventV2 } from '../../../openclaw_runtime/src/trajectory/types';

export type TrajectoryPublication = 'animation-frame' | 'immediate' | 'none';

export type TrajectoryNodeMatch = {
  readonly event: TrajectoryEventV2;
  readonly id: string;
  readonly role: 'start' | 'update';
};

export type TrajectoryNodeStateContext<State> = {
  readonly id: string;
  readonly key: string;
  readonly kind: string;
  readonly startSeq: number;
  readonly state: State;
};

export type TrajectoryViewNode<Data = unknown> = {
  readonly anchorSeq: number;
  readonly data: Data;
  readonly id: string;
  readonly key: string;
  readonly kind: string;
  readonly target: string;
};

export type TrajectoryNodeDefinition<State, Data> = {
  readonly kind: string;
  readonly target: string;
  match(event: TrajectoryEventV2): TrajectoryNodeMatch | null;
  start(match: TrajectoryNodeMatch): State;
  update(context: TrajectoryNodeStateContext<State>, match: TrajectoryNodeMatch): State;
  buildData(context: TrajectoryNodeStateContext<State>): Data;
  publication?(match: TrajectoryNodeMatch): TrajectoryPublication;
};

export type TrajectoryViewBuilder<Node extends TrajectoryViewNode = TrajectoryViewNode, Snapshot = unknown> = {
  apply(upserts: readonly Node[]): Snapshot;
  replace(nodes: readonly Node[]): Snapshot;
};

export type TrajectoryAssemblerScheduler = {
  request(callback: () => void): void;
};

export type TrajectoryAssemblerPublication = {
  readonly mode: 'apply' | 'replace';
  readonly target: string;
  readonly upserts: readonly TrajectoryViewNode[];
};
