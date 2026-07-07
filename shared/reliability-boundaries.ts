export type ReliabilitySubsystem =
  | 'gateway-startup'
  | 'provider-fallback'
  | 'host-api-api-client'
  | 'session-restore-replay'
  | 'file-writes'
  | 'dangerous-approvals'
  | 'task-loop-repair-retry';

export type ReliabilityBoundary = {
  subsystem: ReliabilitySubsystem;
  retry: string;
  idempotency: string;
  recovery: string;
  noGuarantee: string[];
  evidenceRefs: string[];
  relatedTaskIds: string[];
};

export const RELIABILITY_BOUNDARIES: ReliabilityBoundary[] = [
  {
    subsystem: 'gateway-startup',
    retry: 'Main owns Gateway startup and readiness polling for the app shell; readiness can lag after process start.',
    idempotency: 'Startup requests are guarded locally by manager state, not by a global idempotency framework.',
    recovery: 'Renderer can remain usable in connecting/degraded state while Gateway readiness catches up.',
    noGuarantee: [
      'No guarantee that every Gateway method is ready when the process first reports running.',
      'No global retry contract for all Gateway RPC methods.',
    ],
    evidenceRefs: ['electron/gateway/manager.ts', 'harness/specs/rules/gateway-readiness-policy.md'],
    relatedTaskIds: ['P2-06'],
  },
  {
    subsystem: 'provider-fallback',
    retry: 'Provider transport and model fallback paths exist for scoped provider calls.',
    idempotency: 'Provider retries are request-scoped and should not be projected onto tool or file side effects.',
    recovery: 'Fallback can try configured alternatives when provider routing supports it.',
    noGuarantee: [
      'No guarantee that all providers expose identical retry semantics.',
      'No guarantee that provider fallback preserves external side effects.',
    ],
    evidenceRefs: ['openclaw_runtime/src/agents/provider-transport-fetch.ts', 'shared/capability-claims.ts'],
    relatedTaskIds: ['P2-06'],
  },
  {
    subsystem: 'host-api-api-client',
    retry: 'Renderer calls route through host-api/api-client; transport fallback is Main-owned.',
    idempotency: 'Host API calls may be repeatable only when the specific route defines stable keys or read-only behavior.',
    recovery: 'Renderer can surface errors and keep UI state local when Main/Gateway calls fail.',
    noGuarantee: [
      'No renderer-owned protocol switching policy.',
      'No claim that every host route is safe to replay.',
    ],
    evidenceRefs: ['src/lib/host-api.ts', 'src/lib/api-client.ts', 'harness/specs/rules/renderer-main-boundary.md'],
    relatedTaskIds: ['P2-06'],
  },
  {
    subsystem: 'session-restore-replay',
    retry: 'Recovery and handoff flows can reuse checkpoint, transcript, compaction, and queue evidence when present.',
    idempotency: 'Replay and restore are evidence-scoped; repeated UI entry should prepare context rather than silently reapply side effects.',
    recovery: 'Recovery assist can prepare handoff/fork/compact suggestions from available evidence.',
    noGuarantee: [
      'No lossless restore guarantee from summaries.',
      'No automatic replay of arbitrary failed commands or file edits.',
    ],
    evidenceRefs: ['src/pages/Chat/rollback-plan.ts', 'src/pages/Chat/CompactionArtifactViewer.tsx'],
    relatedTaskIds: ['P2-02', 'P2-04', 'P2-06'],
  },
  {
    subsystem: 'file-writes',
    retry: 'File write retries are route/tool specific and must respect workspace permissions.',
    idempotency: 'File writes are not globally idempotent; callers need explicit keys, content checks, or user review.',
    recovery: 'Recovery surfaces may show checkpoint fingerprints when evidence exists.',
    noGuarantee: [
      'No global filesystem mutation idempotency guarantee.',
      'No automatic rollback for arbitrary file writes.',
    ],
    evidenceRefs: ['openclaw_runtime/src/agents/task-loop-controller.ts', 'tests/integration/task-loop-checkpoint-evidence.integration.test.ts'],
    relatedTaskIds: ['P2-01', 'P2-06'],
  },
  {
    subsystem: 'dangerous-approvals',
    retry: 'Dangerous actions require explicit user confirmation when surfaced.',
    idempotency: 'Dangerous approvals are not idempotent by default; approval confirms a specific proposed action.',
    recovery: 'Recovery assist marks dangerous suggestions for manual confirmation.',
    noGuarantee: [
      'Dangerous actions are not automatically replayed.',
      'Approval does not make external side effects reversible.',
    ],
    evidenceRefs: ['src/pages/Chat/rollback-plan.ts', 'shared/types/long-task-control.ts'],
    relatedTaskIds: ['P2-02', 'P2-06'],
  },
  {
    subsystem: 'task-loop-repair-retry',
    retry: 'Task Loop has scoped repair/retry and checkpoint paths for explicit long-running tasks.',
    idempotency: 'Task Loop queue, checkpoint, and intervention records use local idempotency keys where implemented.',
    recovery: 'Task Loop checkpoints can provide recovery anchors and evidence summaries.',
    noGuarantee: [
      'No claim that ordinary Chat turns inherit Task Loop repair semantics.',
      'No global guarantee that every tool side effect is replay-safe.',
    ],
    evidenceRefs: ['openclaw_runtime/src/agents/task-loop-controller.ts', 'tests/unit/user-message-queue.test.ts'],
    relatedTaskIds: ['P2-01', 'P2-06'],
  },
];

export function findReliabilityBoundary(subsystem: ReliabilitySubsystem): ReliabilityBoundary | undefined {
  return RELIABILITY_BOUNDARIES.find((entry) => entry.subsystem === subsystem);
}
