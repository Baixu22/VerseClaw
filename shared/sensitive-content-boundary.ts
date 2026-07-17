export type SensitiveContentSurface =
  | 'file'
  | 'transcript'
  | 'trace'
  | 'memory'
  | 'compaction'
  | 'modelEcho'
  | 'sekb'

export type SensitiveContentGuaranteeLevel =
  | 'raw-no-redaction'
  | 'local-policy'
  | 'redacted-projection'
  | 'local-rejection'
  | 'source-safeguard'
  | 'not-guaranteed';

export type SensitiveContentBoundaryEntry = {
  surface: SensitiveContentSurface;
  label: string;
  guaranteeLevel: SensitiveContentGuaranteeLevel;
  safeClaim: string;
  noGuarantee: string;
  evidenceRefs: string[];
  relatedTaskIds: string[];
  rawPlaintextRisk: boolean;
  fullPlaintextFreeGuarantee: false;
};

export const SENSITIVE_CONTENT_BOUNDARY_MATRIX = [
  {
    surface: 'file',
    label: 'Workspace files and patches',
    guaranteeLevel: 'raw-no-redaction',
    safeClaim: 'Workspace files are raw user/project artifacts; code-review runtime prompts use a redacted diff projection for fake key-shaped content.',
    noGuarantee: 'No automatic plaintext-free guarantee for raw files, raw Git diffs, or copy-patch UI surfaces; P1-11 covers the code-review prompt projection only.',
    evidenceRefs: [
      'reports/report-authenticity-true-false-positive-matrix-2026-07-04.md',
      'electron/services/code-review-api.ts',
      'tests/unit/code-review-center.test.ts',
      'tests/integration/p1-sensitive-content-boundary.integration.test.ts',
    ],
    relatedTaskIds: ['P1-11', 'P1-14'],
    rawPlaintextRisk: true,
    fullPlaintextFreeGuarantee: false,
  },
  {
    surface: 'transcript',
    label: 'Session transcripts',
    guaranteeLevel: 'local-policy',
    safeClaim: 'Session transcript persistence calls redactTranscriptMessage before append/write, and the local policy redacts fake key-shaped text unless logging.redactSensitive is off.',
    noGuarantee: 'This is not 鐪熷疄 chat 娉ㄥ叆 E2E proof, and config/off or uncovered payload shapes can still leave raw transcript plaintext.',
    evidenceRefs: [
      'openclaw_runtime/src/agents/transcript-redact.ts',
      'openclaw_runtime/src/config/sessions/transcript.ts',
      'openclaw_runtime/src/config/sessions/transcript-append.ts',
      'tests/unit/sensitive-content-boundary.test.ts',
      'tests/integration/p1-sensitive-content-boundary.integration.test.ts',
    ],
    relatedTaskIds: ['P1-10', 'P1-14'],
    rawPlaintextRisk: true,
    fullPlaintextFreeGuarantee: false,
  },
  {
    surface: 'trace',
    label: 'Observability traces',
    guaranteeLevel: 'redacted-projection',
    safeClaim: 'Observability persistence stores redacted summaries, hashes, lengths, and sanitized attributes for sensitive-looking trace fields.',
    noGuarantee: 'Trace redaction is a projection boundary; it does not prove raw transcripts, files, or provider payloads are plaintext-free.',
    evidenceRefs: [
      'electron/services/observability-redaction.ts',
      'tests/unit/sensitive-content-boundary.test.ts',
      'tests/unit/observability-namespace.test.ts',
      'tests/integration/p1-sensitive-content-boundary.integration.test.ts',
    ],
    relatedTaskIds: ['P1-11', 'P1-14'],
    rawPlaintextRisk: false,
    fullPlaintextFreeGuarantee: false,
  },
  {
    surface: 'memory',
    label: 'Memory proposals and cards',
    guaranteeLevel: 'local-rejection',
    safeClaim: 'Memory has gatekeeper/review paths for secret-like proposals; the memory.propose Gateway handler rejects fake keys and redacts the full secret from returned proposal feedback.',
    noGuarantee: 'This is Gateway handler and SQLite feedback evidence, not a full Electron UI or WebSocket E2E guarantee for every memory entrypoint.',
    evidenceRefs: [
      'openclaw_runtime/src/memory/gatekeeper.ts',
      'openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts',
      'tests/unit/role-orchestration-methods.test.ts',
      'tests/integration/p1-sensitive-content-boundary.integration.test.ts',
      'tests/unit/runtime-memory-write-path-semantic-real.test.ts',
      'tests/unit/memory-api.test.ts',
    ],
    relatedTaskIds: ['P1-13', 'P1-14'],
    rawPlaintextRisk: true,
    fullPlaintextFreeGuarantee: false,
  },
  {
    surface: 'compaction',
    label: 'Compaction summaries and artifacts',
    guaranteeLevel: 'redacted-projection',
    safeClaim: 'Compaction artifact, rendered summary, and recovery projection redact fake key-shaped content while preserving recovery fields.',
    noGuarantee: 'This is deterministic artifact/projection evidence, not proof that provider-generated summaries or model echoes are globally plaintext-free.',
    evidenceRefs: [
      'openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts',
      'openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts',
      'openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts',
      'tests/unit/compression-artifact.test.ts',
      'tests/integration/p1-sensitive-content-boundary.integration.test.ts',
    ],
    relatedTaskIds: ['P1-12', 'P1-14'],
    rawPlaintextRisk: true,
    fullPlaintextFreeGuarantee: false,
  },
    {
    surface: 'sekb',
    label: 'SEKB trajectories and steps_json',
    guaranteeLevel: 'redacted-projection',
    safeClaim: 'SEKB trajectory persistence runs sanitizeTrajectoryForPersistence before steps_json write: shared logging redaction plus default quarantine for unclassified tool input/output (P3-001).',
    noGuarantee: 'This is SEKB store projection evidence, not a guarantee for provider payloads, model echoes, or pre-capture in-memory steps.',
    evidenceRefs: [
      'openclaw_runtime/src/knowledge/sekb/trajectory-redaction.ts',
      'openclaw_runtime/src/knowledge/sekb/trajectory-capture.ts',
      'openclaw_runtime/src/knowledge/sekb/knowledge-store.ts',
      'openclaw_runtime/src/logging/redact.ts',
      'tests/unit/sekb-trajectory-redaction-p3-001.test.ts',
    ],
    relatedTaskIds: ['P3-001', 'P1-14'],
    rawPlaintextRisk: false,
    fullPlaintextFreeGuarantee: false,
  },
  {
    surface: 'modelEcho',
    label: 'Model echo and assistant output',
    guaranteeLevel: 'not-guaranteed',
    safeClaim: 'Assistant/model output should be treated as generated text that may repeat user-provided secret-like content.',
    noGuarantee: 'There is no system-wide model echo plaintext-free guarantee; users should not submit real secrets as prompts.',
    evidenceRefs: [
      'reports/report-authenticity-true-false-positive-matrix-2026-07-04.md',
    ],
    relatedTaskIds: ['P1-10', 'P1-14'],
    rawPlaintextRisk: true,
    fullPlaintextFreeGuarantee: false,
  },
] satisfies SensitiveContentBoundaryEntry[];

export function findSensitiveContentBoundary(
  surface: SensitiveContentSurface,
): SensitiveContentBoundaryEntry | undefined {
  return SENSITIVE_CONTENT_BOUNDARY_MATRIX.find((entry) => entry.surface === surface);
}
