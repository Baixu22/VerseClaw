# Contracts And Boundaries

These are draft contracts for future implementation specs. They are intentionally narrow and may be refined by schema tests before runtime use.

## FailureEvent

```ts
type FailureStage =
  | 'planning'
  | 'tool_call'
  | 'patch'
  | 'test'
  | 'provider'
  | 'gateway'
  | 'user_interrupt'
  | 'unknown';

type FailureKind =
  | 'permission'
  | 'path'
  | 'dependency'
  | 'timeout'
  | 'type_error'
  | 'test_failure'
  | 'environment_contamination'
  | 'context_insufficient'
  | 'provider_error'
  | 'gateway_error'
  | 'unknown';

type FailureRecoverability =
  | 'auto_recoverable'
  | 'retryable'
  | 'ask_user'
  | 'rollback_recommended'
  | 'non_recoverable'
  | 'unknown';

type SuggestedAction =
  | 'retry'
  | 'ask_user'
  | 'rollback_recommended'
  | 'degrade'
  | 'stop'
  | 'continue_with_caution';

type FailureEvent = {
  id: string;
  runId?: string;
  stage: FailureStage;
  kind: FailureKind;
  recoverability: FailureRecoverability;
  suggestedAction: SuggestedAction;
  confidence: number;
  source: string;
  occurredAt: string;
  summary: string;
  evidenceRefs: string[];
  rawRetained: false;
  redaction: 'sanitized' | 'metadata_only';
};
```

Boundary:

- A `FailureEvent` is diagnostic evidence.
- It may inform a future accepted consumer.
- It must not directly retry, ask the user, roll back, block tools, change provider selection, change Gateway routing, or mark completion.

## EvidenceEnvelope

```ts
type EvidenceEnvelope = {
  id: string;
  kind:
    | 'failure_summary'
    | 'test_result_summary'
    | 'file_change_summary'
    | 'agent_map_summary'
    | 'benchmark_summary'
    | 'replay_summary'
    | 'tool_result_summary';
  source: {
    component: string;
    runId?: string;
    command?: string;
    file?: string;
  };
  scope: {
    workspace?: string;
    sessionId?: string;
    runId?: string;
    taskId?: string;
    paths?: string[];
  };
  createdAt: string;
  ttlMs: number;
  confidence: number;
  redaction: {
    state: 'metadata_only' | 'sanitized' | 'redacted';
    rawRetained: false;
    secretScan: 'pass' | 'not_run';
  };
  provenance: {
    producer: string;
    version: string;
    inputs: string[];
  };
  authority: 'none';
  payload: unknown;
};
```

Fail closed when:

- missing required fields
- expired TTL
- scope mismatch
- confidence below consumer threshold
- redaction state missing
- `rawRetained` is true
- authority is not `none`
- payload exceeds budget
- source/provenance cannot be traced

Persistence boundary:

- Envelope reports may be test-owned, caller-owned, or local dev artifacts.
- Envelope payloads must not be written into checkpoint/lifecycle authority state.
- Any durable storage requires a future retention/redaction spec.

## ReplayCase

```ts
type ReplayCase = {
  id: string;
  title: string;
  scenario:
    | 'success'
    | 'tool_error'
    | 'test_failure'
    | 'provider_timeout'
    | 'dirty_workspace'
    | 'blocked'
    | 'long_context'
    | 'flaky_test'
    | 'user_interruption'
    | 'budget_exhausted';
  input: {
    userMessage: string;
    workspaceFixture: string;
    providerFixture: string;
    toolFixture: string;
    configFixture?: string;
  };
  expected: {
    terminalStatus: 'completed' | 'blocked' | 'failed' | 'interrupted';
    allowedFailureKinds?: FailureKind[];
    disallowedActions?: SuggestedAction[];
    touchedPaths?: string[];
  };
  budgets: {
    maxPromptBytes?: number;
    maxToolCalls?: number;
    maxDurationMs?: number;
  };
};
```

Boundary:

- Replay is a dev/test/evaluation harness.
- It does not run live providers by default.
- It must not mutate a developer workspace outside a fixture/worktree sandbox defined by a future implementation spec.

## TaskOutcomeScorecard

```ts
type TaskOutcomeScorecard = {
  replayCaseId: string;
  status: 'improved' | 'regressed' | 'neutral' | 'inconclusive';
  metrics: {
    taskCompleted: boolean;
    wrongFileEdit: boolean;
    unnecessaryEdit: boolean;
    testRecoverySuccess: boolean;
    retryCorrectness: 'pass' | 'fail' | 'not_applicable';
    askUserAppropriateness: 'pass' | 'fail' | 'not_applicable';
    promptByteDrift?: number;
    authorityEscalation: boolean;
    rollbackCorrectness?: 'pass' | 'fail' | 'not_applicable';
    timeBudgetUse?: number;
    costBudgetUse?: number;
  };
  evidenceRefs: string[];
};
```

Boundary:

- Scorecard is evaluation metadata.
- It must not claim real user task completion.
- It must not become a runtime gate until a future accepted gate spec defines thresholds, false-positive handling, and rollback.

## ToolGovernanceDecision

```ts
type ToolGovernanceDecision = {
  id: string;
  runId?: string;
  toolName: string;
  commandKind:
    | 'read_only'
    | 'write'
    | 'destructive'
    | 'long_running'
    | 'network'
    | 'unknown';
  decision:
    | 'allow'
    | 'warn'
    | 'ask_user'
    | 'backoff'
    | 'block';
  reason:
    | 'destructive_operation'
    | 'repeated_failure'
    | 'timeout'
    | 'environment_contamination'
    | 'missing_context'
    | 'policy'
    | 'unknown';
  confidence: number;
  evidenceRefs: string[];
  rawRetained: false;
};
```

Boundary:

- Governance may start as advisory diagnostics.
- Active blocking requires a follow-up spec, replay evidence, scorecard impact, and rollback.
- Governance must avoid broad pattern-only blocking that prevents normal dev commands, test runners, or long-running dev servers.
