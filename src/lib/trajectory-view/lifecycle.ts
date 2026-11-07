import type { SessionActivitySnapshot } from '@shared/types/session-activity';
import type { TrajectoryEventV2, TrajectoryNodeDefinition } from '../trajectory-assembler';

export type LifecycleData = {
  id: string;
  role: TrajectoryEventV2['role'];
  runId: string;
  seq: number;
  status: SessionActivitySnapshot['session']['status'];
  startedAt: number;
  endedAt: number | null;
  updatedAt: number;
  error: string | null;
};

function timestamp(event: TrajectoryEventV2): number {
  const value = Date.parse(event.ts);
  return Number.isFinite(value) ? value : 0;
}

function data(event: TrajectoryEventV2, id: string, startedAt = timestamp(event)): LifecycleData {
  const status = String(event.state.status ?? '');
  return {
    id, role: event.role, runId: event.runId, seq: event.seq,
    status: event.phase !== 'end' ? 'running'
      : ['error', 'failed', 'timeout'].includes(status) ? 'failed'
        : ['aborted', 'cancelled', 'canceled'].includes(status) ? 'aborted' : 'completed',
    startedAt,
    endedAt: event.phase === 'end' ? timestamp(event) : null,
    updatedAt: timestamp(event),
    error: typeof event.state.error === 'string' ? event.state.error
      : typeof event.state.terminalError === 'string' ? event.state.terminalError : null,
  };
}

export const lifecycleDefinitions: readonly TrajectoryNodeDefinition<LifecycleData, LifecycleData>[] =
  (['run', 'turn', 'step', 'tool'] as const).map((role) => ({
    kind: role,
    target: 'lifecycle',
    match: (event) => {
      if (event.role !== role) return null;
      const id = event.role === 'run' ? event.runId : event.role === 'turn' ? event.turnId
        : event.role === 'step' ? event.stepId : event.toolCallId;
      return { event, id: `${event.runId}:${id}`, role: event.phase === 'start' ? 'start' : 'update' };
    },
    start: ({ event, id }) => data(event, id),
    update: (context, { event, id }) => data(event, id, context.state.startedAt),
    buildData: (context) => context.state,
    publication: () => 'immediate',
  }));
