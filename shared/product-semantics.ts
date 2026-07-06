import {
  createTaskLedgerReference as createCanonicalTaskLedgerReference,
  type TaskLedgerReference,
} from './types/task-ledger-reference';
import type { WorkspacePermissionMode } from './types/workspace';

export type { TaskLedgerReference } from './types/task-ledger-reference';

export type ProductSemanticConceptId =
  | 'chat'
  | 'plan-mode'
  | 'chat-plan'
  | 'task-ledger'
  | 'workboard'
  | 'task-loop'
  | 'routing-memo';

export type ProductSemanticConcept = {
  id: ProductSemanticConceptId;
  positioning: string;
  sourceOfTruth: string;
  allowedReferences: string[];
  forbiddenClaims: string[];
};

export const PRODUCT_SEMANTIC_CONCEPTS = [
  {
    id: 'chat',
    positioning: 'Immediate user/agent collaboration surface',
    sourceOfTruth: 'conversation transcript',
    allowedReferences: ['Task Loop upgrade suggestion', 'read-only Chat Plan projection'],
    forbiddenClaims: [
      'ordinary Chat is an automatic project manager',
      'ordinary Chat automatically enters Task Loop',
    ],
  },
  {
    id: 'plan-mode',
    positioning: 'Permission-gated planning posture',
    sourceOfTruth: 'workspace permission decision',
    allowedReferences: ['system metadata exception boundary', 'permission decision audit event'],
    forbiddenClaims: [
      'strict no-diff guarantee for every file or metadata write',
      'full workflow state machine',
    ],
  },
  {
    id: 'chat-plan',
    positioning: 'Read-only projection of orchestration intent',
    sourceOfTruth: 'orchestrator plan output',
    allowedReferences: ['Task Ledger read-only node projection'],
    forbiddenClaims: [
      'editable Chat DAG',
      'drag-and-drop dependency editor',
      'transactional task edit rollback',
    ],
  },
  {
    id: 'task-ledger',
    positioning: 'App/user-visible task fact ledger',
    sourceOfTruth: 'user-visible task facts',
    allowedReferences: ['Chat Plan projection', 'Task Loop root/checkpoint evidence'],
    forbiddenClaims: [
      'execution scheduler',
      'plugin dispatch queue',
      'Workboard mirror with automatic two-way sync',
    ],
  },
  {
    id: 'workboard',
    positioning: 'Runtime/plugin scheduling and dispatch board',
    sourceOfTruth: 'runtime/plugin scheduling',
    allowedReferences: ['Task Ledger node id'],
    forbiddenClaims: [
      'user-visible task fact source of truth',
      'two-way sync back into Task Ledger',
    ],
  },
  {
    id: 'task-loop',
    positioning: 'Explicit high-constraint execution loop',
    sourceOfTruth: 'Task Ledger root plus loop run/checkpoint state',
    allowedReferences: ['Task Ledger root', 'checkpoint', 'repair', 'blocked state'],
    forbiddenClaims: [
      'ordinary Chat failure semantics',
      'implicit automatic start from every complex prompt',
    ],
  },
  {
    id: 'routing-memo',
    positioning: 'Routing observation memo, shadow until scorecard-backed',
    sourceOfTruth: 'observed routing outcome and quality state',
    allowedReferences: ['shadow observation', 'active scorecard-backed routing input'],
    forbiddenClaims: [
      'default active learning',
      'automatic role elimination without scorecard input',
    ],
  },
] as const satisfies readonly ProductSemanticConcept[];

export type ProductSemanticUnsafeClaim = {
  id:
    | 'chat-editable-dag'
    | 'chat-auto-task-loop'
    | 'team-orchestrate-complete-quality'
    | 'routing-memo-default-learning'
    | 'plan-mode-strict-no-diff';
  unsafe: string;
  safe: string;
  patterns: readonly RegExp[];
};

export const PRODUCT_SEMANTIC_UNSAFE_CLAIMS = [
  {
    id: 'chat-editable-dag',
    unsafe: 'Chat plan exposes an editable DAG.',
    safe: 'Chat Plan is a read-only projection; lightweight edits must not be described as DAG editing.',
    patterns: [
      /\bchat\b.{0,60}\beditable\b.{0,30}\bdag\b/i,
      /\bchat plan\b.{0,60}\b(edit|drag|dependency)\b.{0,30}\bdag\b/i,
    ],
  },
  {
    id: 'chat-auto-task-loop',
    unsafe: 'Ordinary Chat automatically starts or enters Task Loop.',
    safe: 'Ordinary Chat may suggest a Task Loop upgrade; the user must confirm it.',
    patterns: [
      /\bordinary chat\b.{0,60}\b(auto|automatic|automatically)\b.{0,40}\btask loop\b/i,
      /\bchat\b.{0,40}\b(auto|automatic|automatically)\b.{0,40}\btask loop\b/i,
    ],
  },
  {
    id: 'team-orchestrate-complete-quality',
    unsafe: 'Ordinary team_orchestrate returns complete quality scoring.',
    safe: 'Ordinary team_orchestrate uses explicit null/shadow/active quality state; Task Loop owns repair semantics.',
    patterns: [
      /\bordinary\s+team_orchestrate\b.{0,80}\bcomplete quality scoring\b/i,
      /\bteam_orchestrate\b.{0,80}\b(full|complete)\b.{0,30}\bquality (score|scoring|scorecard)\b/i,
    ],
  },
  {
    id: 'routing-memo-default-learning',
    unsafe: 'Routing Memo learns role quality by default.',
    safe: 'Routing Memo remains shadow until scorecard-backed active state is available.',
    patterns: [
      /\brouting memo\b.{0,60}\b(learns|learning)\b.{0,30}\bby default\b/i,
      /\brouting memo\b.{0,40}\bdefault\b.{0,40}\b(active|learning)\b/i,
    ],
  },
  {
    id: 'plan-mode-strict-no-diff',
    unsafe: 'Plan mode provides strict no-diff execution for every write.',
    safe: 'Plan mode is a permission gate for user file writes; system metadata writes are explicit exceptions.',
    patterns: [
      /\bplan mode\b.{0,60}\bstrict no-diff\b/i,
      /\bplan mode\b.{0,80}\bno-diff\b.{0,30}\bevery write\b/i,
    ],
  },
] as const satisfies readonly ProductSemanticUnsafeClaim[];

export type ProductSemanticTaskId = `P0-${string}` | `P1-${string}`;
export type ProductSemanticImplementationStatus = 'done' | 'todo' | 'defer';
export type ProductSemanticTaskLane =
  | 'architecture-drift'
  | 'claim-governance'
  | 'runtime-evidence'
  | 'observability'
  | 'chat-history'
  | 'execution-graph'
  | 'permission-boundary'
  | 'backend-boundary'
  | 'provider-config'
  | 'chat-plan'
  | 'task-ledger-workboard'
  | 'orchestration-quality'
  | 'orchestration-diagnostics'
  | 'routing-memo'
  | 'chat-to-task-loop'
  | 'task-loop'
  | 'sensitive-boundary';

export type ProductSemanticTaskBoundary = {
  id: ProductSemanticTaskId;
  title: string;
  implementationStatus: ProductSemanticImplementationStatus;
  semanticStatus: 'positioned';
  lane: ProductSemanticTaskLane;
  sourceOfTruth: string;
  safeClaim: string;
  forbiddenClaim: string;
  nextAction: string;
  boundaryRefs: string[];
};

function task(input: Omit<ProductSemanticTaskBoundary, 'semanticStatus'>): ProductSemanticTaskBoundary {
  return { semanticStatus: 'positioned', ...input };
}

export const PRODUCT_SEMANTIC_TASK_BOUNDARIES = [
  task({
    id: 'P0-00',
    title: 'Current architecture drift registry',
    implementationStatus: 'done',
    lane: 'architecture-drift',
    sourceOfTruth: 'report drift categories and real-runtime evidence',
    safeClaim: 'Fixes are triaged as core-blocking, observation-only, docs-drift, or advanced-feature before code changes.',
    forbiddenClaim: 'Old knowledge-base descriptions automatically override the running architecture.',
    nextAction: 'Keep new P0/P1 work classified before implementation.',
    boundaryRefs: ['reports/report-authenticity-true-false-positive-matrix-2026-07-04.md'],
  }),
  task({
    id: 'P0-01',
    title: 'Capability claim acceptance matrix',
    implementationStatus: 'done',
    lane: 'claim-governance',
    sourceOfTruth: 'shared/capability-claims.ts',
    safeClaim: 'Claims must connect safe wording, evidence, user path, runtime proof, and exclusions.',
    forbiddenClaim: 'Source existence alone proves product availability.',
    nextAction: 'Use the matrix for new README, report, and product copy claims.',
    boundaryRefs: ['shared/capability-claims.ts', 'tests/unit/capability-claims.test.ts'],
  }),
  task({
    id: 'P0-02',
    title: 'Machine-readable capability status table',
    implementationStatus: 'done',
    lane: 'claim-governance',
    sourceOfTruth: 'artifacts/capability-claims/status-table.json',
    safeClaim: 'Capability state is available as generated audit data.',
    forbiddenClaim: 'Manual report prose is the only source of truth.',
    nextAction: 'Regenerate the artifact when capability claims change.',
    boundaryRefs: ['scripts/generate-capability-claims-artifacts.mjs', 'artifacts/capability-claims/status-table.json'],
  }),
  task({
    id: 'P0-03',
    title: 'High-risk claim gate',
    implementationStatus: 'done',
    lane: 'claim-governance',
    sourceOfTruth: 'scripts/check-capability-claims.mjs',
    safeClaim: 'High-confidence or unsafe wording is checked against evidence and product semantics.',
    forbiddenClaim: 'Docs may claim productized behavior without evidence references.',
    nextAction: 'Run the gate for README/report/product-copy changes.',
    boundaryRefs: ['scripts/check-capability-claims.mjs', 'tests/unit/capability-claims.test.ts'],
  }),
  task({
    id: 'P0-04',
    title: 'Pinned real-runtime validation script',
    implementationStatus: 'done',
    lane: 'runtime-evidence',
    sourceOfTruth: 'scripts/real-runtime-validation.mjs standardized reports',
    safeClaim: 'Runtime reports separate core execution, trace, graph, and history evidence.',
    forbiddenClaim: 'A single pass/fail line proves every observation surface.',
    nextAction: 'Use standardized reports for future real-runtime claims.',
    boundaryRefs: ['scripts/real-runtime-validation.mjs', 'tests/unit/real-runtime-validation-report.test.ts'],
  }),
  task({
    id: 'P0-05',
    title: 'False-positive capability labels',
    implementationStatus: 'done',
    lane: 'claim-governance',
    sourceOfTruth: 'capability classification vocabulary',
    safeClaim: 'Reports use TP-RUN, TP-TEST, TP-SRC, PARTIAL, FP-OVERCLAIM, and FP-NOT-RUNNABLE.',
    forbiddenClaim: 'Partial source evidence is equivalent to runnable user capability.',
    nextAction: 'Apply the vocabulary to new matrices and follow-up reports.',
    boundaryRefs: ['shared/capability-claims.ts'],
  }),
  task({
    id: 'P0-06',
    title: 'Real task trace queryability',
    implementationStatus: 'done',
    lane: 'observability',
    sourceOfTruth: 'App observability trace index',
    safeClaim: 'Trace query evidence exists for scoped real-runtime runs, while complete audit remains partial.',
    forbiddenClaim: 'Trace queryability equals full audit productization.',
    nextAction: 'Keep deeper per-span audit as a separate enhancement.',
    boundaryRefs: ['electron/services/observability-api.ts', 'tests/unit/observability-trajectory-index.test.ts'],
  }),
  task({
    id: 'P0-07',
    title: 'Runtime trajectory to App trace mapping',
    implementationStatus: 'done',
    lane: 'observability',
    sourceOfTruth: 'trajectory/transcript-derived trace index',
    safeClaim: 'Runtime artifacts can be projected into App trace spans for scoped runs.',
    forbiddenClaim: 'Every runtime event is already human-auditable in the UI.',
    nextAction: 'Add manual audit detail only if release claims need it.',
    boundaryRefs: ['electron/services/observability-trajectory-index.ts'],
  }),
  task({
    id: 'P0-08',
    title: 'Chat history startup recovery',
    implementationStatus: 'done',
    lane: 'chat-history',
    sourceOfTruth: 'Gateway history plus local transcript fallback',
    safeClaim: 'Startup-window history has retry and transcript artifact recovery evidence.',
    forbiddenClaim: 'Direct chat.history startup RPC never fails.',
    nextAction: 'Keep direct RPC failures visible in raw evidence while allowing recovery.',
    boundaryRefs: ['src/stores/chat/history-startup-retry.ts', 'src/stores/chat/history-transcript-fallback.ts'],
  }),
  task({
    id: 'P0-09',
    title: 'Execution graph runtime binding',
    implementationStatus: 'done',
    lane: 'execution-graph',
    sourceOfTruth: 'chat history tool calls/results and task visualization projection',
    safeClaim: 'Execution graph can show scoped read/edit/exec/tool result/final assistant projections.',
    forbiddenClaim: 'The graph is a complete runtime audit chain.',
    nextAction: 'Treat per-toolCallId audit as a separate observability enhancement.',
    boundaryRefs: ['src/pages/Chat/task-visualization.ts', 'tests/unit/task-visualization.test.ts'],
  }),
  task({
    id: 'P0-10',
    title: 'Core versus observation report separation',
    implementationStatus: 'done',
    lane: 'runtime-evidence',
    sourceOfTruth: 'standardized real-runtime report sections',
    safeClaim: 'Core execution and observation evidence are reported separately.',
    forbiddenClaim: 'Observation failure automatically means the agent task failed.',
    nextAction: 'Preserve separate statuses in future validation reports.',
    boundaryRefs: ['scripts/real-runtime-validation.mjs'],
  }),
  task({
    id: 'P0-11',
    title: 'Plan mode system metadata boundary',
    implementationStatus: 'done',
    lane: 'permission-boundary',
    sourceOfTruth: 'standard report user-file versus system-metadata diff split',
    safeClaim: 'Plan mode separates user-file diff from explicit system metadata writes.',
    forbiddenClaim: 'Plan mode is strict no-diff for every write.',
    nextAction: 'Keep system metadata exceptions visible in reports.',
    boundaryRefs: ['docs/clawx-product-semantics.md', 'scripts/real-runtime-validation.mjs'],
  }),
  task({
    id: 'P0-12',
    title: 'Plan mode real write challenge E2E',
    implementationStatus: 'defer',
    lane: 'permission-boundary',
    sourceOfTruth: 'workspace permission unit policy',
    safeClaim: 'Plan mode has unit-level write/exec denial evidence.',
    forbiddenClaim: 'Plan mode has passed a real write challenge E2E.',
    nextAction: 'Add Electron E2E only when permission productization becomes the active task.',
    boundaryRefs: ['electron/services/workspace-permissions.ts', 'tests/unit/workspace-permissions.test.ts'],
  }),
  task({
    id: 'P0-13',
    title: 'Unified permission audit event',
    implementationStatus: 'defer',
    lane: 'permission-boundary',
    sourceOfTruth: 'PermissionDecisionEvent schema boundary',
    safeClaim: 'A normalized PermissionDecisionEvent shape exists as a contract boundary.',
    forbiddenClaim: 'Unified permission audit is productized across Workspace and Role systems.',
    nextAction: 'Wire minimal producers before claiming audit traceability.',
    boundaryRefs: ['shared/product-semantics.ts', 'tests/unit/product-semantics.test.ts'],
  }),
  task({
    id: 'P0-14',
    title: 'Renderer backend boundary gate',
    implementationStatus: 'done',
    lane: 'backend-boundary',
    sourceOfTruth: 'harness backend communication boundary rule',
    safeClaim: 'New renderer direct IPC/Gateway HTTP/WS calls are blocked by static harness checks.',
    forbiddenClaim: 'All historical renderer code has been exhaustively cleaned.',
    nextAction: 'Run harness validation for backend communication changes.',
    boundaryRefs: ['harness/specs/rules/backend-communication-boundary.md', 'harness/src/rules.mjs'],
  }),
  task({
    id: 'P0-15',
    title: 'DeepSeek model authority source',
    implementationStatus: 'done',
    lane: 'provider-config',
    sourceOfTruth: 'provider account/default/main/transcript/trajectory consistency evidence',
    safeClaim: 'The scoped DeepSeek flash default drift is closed for the validated run.',
    forbiddenClaim: 'All future provider switching scenarios are productized.',
    nextAction: 'Use model consistency evidence for provider default claims.',
    boundaryRefs: ['scripts/model-consistency-evidence.mjs'],
  }),
  task({
    id: 'P0-16',
    title: 'Provider defaults persistence',
    implementationStatus: 'done',
    lane: 'provider-config',
    sourceOfTruth: 'provider account-first runtime sync',
    safeClaim: 'The validated runtime default no longer falls back to the old DeepSeek pro value.',
    forbiddenClaim: 'Provider defaults can never drift in any future configuration.',
    nextAction: 'Keep provider sync tests near account/default persistence changes.',
    boundaryRefs: ['electron/gateway/config-sync.ts', 'tests/unit/config-sync-source-runtime.test.ts'],
  }),
  task({
    id: 'P0-17',
    title: 'Provider configuration formal entrypoint',
    implementationStatus: 'done',
    lane: 'provider-config',
    sourceOfTruth: 'provider:deepseek:configure CLI',
    safeClaim: 'DeepSeek configuration has a repeatable CLI entrypoint that avoids printing keys.',
    forbiddenClaim: 'Doctor Fix automatically changes provider defaults for every user.',
    nextAction: 'Keep auto-fix behavior separate from explicit provider configuration.',
    boundaryRefs: ['scripts/configure-deepseek-runtime.mjs', 'tests/unit/configure-deepseek-runtime.test.ts'],
  }),
  task({
    id: 'P1-01',
    title: 'Chat Plan to Task Ledger read-only projection',
    implementationStatus: 'done',
    lane: 'chat-plan',
    sourceOfTruth: 'orchestrator.plan projection events in Task Ledger',
    safeClaim: 'Chat Plan can project read-only nodes into Task Ledger.',
    forbiddenClaim: 'Chat Plan is an editable DAG.',
    nextAction: 'Keep dependency editing out of this claim.',
    boundaryRefs: ['src/lib/task-ledger-plan-projection.ts', 'tests/unit/orchestration-plan-ledger-projection.test.ts'],
  }),
  task({
    id: 'P1-02',
    title: 'Lightweight Chat Plan editing',
    implementationStatus: 'todo',
    lane: 'chat-plan',
    sourceOfTruth: 'future lightweight edit contract',
    safeClaim: 'Future scope is reorder, disable, note, or regenerate plan controls only.',
    forbiddenClaim: 'A full drag-and-drop DAG editor is planned as the default fix.',
    nextAction: 'Define lightweight controls before adding UI.',
    boundaryRefs: ['docs/clawx-product-semantics.md'],
  }),
  task({
    id: 'P1-03',
    title: 'Task Ledger and Workboard data relationship',
    implementationStatus: 'todo',
    lane: 'task-ledger-workboard',
    sourceOfTruth: 'Task Ledger facts plus Workboard scheduling references',
    safeClaim: 'Workboard may reference Task Ledger node ids one-way.',
    forbiddenClaim: 'Task Ledger and Workboard are one mirrored two-way task system.',
    nextAction: 'Use TaskLedgerReference for Workboard link semantics.',
    boundaryRefs: ['shared/product-semantics.ts', 'openclaw_runtime/extensions/workboard/src/types.ts'],
  }),
  task({
    id: 'P1-04',
    title: 'Ordinary orchestration quality state',
    implementationStatus: 'todo',
    lane: 'orchestration-quality',
    sourceOfTruth: 'team_orchestrate qualityState field',
    safeClaim: 'Ordinary team_orchestrate currently reports qualityState=null until scorecard evidence exists.',
    forbiddenClaim: 'Ordinary team_orchestrate has a complete quality scorecard.',
    nextAction: 'Only move to shadow or active after real scorecard inputs exist.',
    boundaryRefs: ['openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts', 'shared/product-semantics.ts'],
  }),
  task({
    id: 'P1-05',
    title: 'Ordinary orchestration diagnostics',
    implementationStatus: 'done',
    lane: 'orchestration-diagnostics',
    sourceOfTruth: 'ordinary orchestrationDiagnostics payload',
    safeClaim: 'Ordinary orchestration may show partial status and diagnostic recommendations.',
    forbiddenClaim: 'Ordinary orchestration automatically enters Task Loop repair/blocked semantics.',
    nextAction: 'Keep repair, blocked, and checkpoint fields exclusive to explicit Task Loop runs.',
    boundaryRefs: [
      'openclaw_runtime/src/agents/orchestration-protocol.ts',
      'src/pages/Chat/TeamOrchestrationCard.tsx',
      'tests/integration/p1-orchestration-boundary.integration.test.ts',
    ],
  }),
  task({
    id: 'P1-06',
    title: 'Routing Memo shadow dashboard',
    implementationStatus: 'done',
    lane: 'routing-memo',
    sourceOfTruth: 'routing_memo.summary dashboard',
    safeClaim: 'Routing Memo can be observed in shadow without changing routing.',
    forbiddenClaim: 'Routing Memo default learning is active.',
    nextAction: 'Use the dashboard as evidence only; do not promote shadow observations into active routing.',
    boundaryRefs: [
      'openclaw_runtime/src/agents/routing-memo.ts',
      'src/components/agents/RolesOrchestrationPanel.tsx',
      'tests/unit/routing-memo.test.ts',
    ],
  }),
  task({
    id: 'P1-07',
    title: 'Routing Memo real quality input',
    implementationStatus: 'done',
    lane: 'routing-memo',
    sourceOfTruth: 'scorecard-backed OrchestrationQualityState',
    safeClaim: 'Routing Memo may become active only after scorecard-backed qualityOverall input exists.',
    forbiddenClaim: 'Routing Memo learns from unreliable or unwired quality signals.',
    nextAction: 'Keep ordinary team_orchestrate at qualityState=null until real scorecard producers exist.',
    boundaryRefs: [
      'openclaw_runtime/src/agents/orchestrator.ts',
      'openclaw_runtime/src/agents/routing-memo.ts',
      'openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts',
    ],
  }),
  task({
    id: 'P1-08',
    title: 'Explicit Chat to Task Loop upgrade',
    implementationStatus: 'done',
    lane: 'chat-to-task-loop',
    sourceOfTruth: 'TaskLoopUpgradeSuggestion',
    safeClaim: 'Ordinary Chat may show an upgrade suggestion that requires user confirmation.',
    forbiddenClaim: 'Ordinary Chat automatically starts Task Loop.',
    nextAction: 'Keep Task Ledger root creation and task_loop.run behind explicit confirmation.',
    boundaryRefs: [
      'src/pages/Chat/task-loop-upgrade.ts',
      'src/pages/Chat/ChatInput.tsx',
      'tests/e2e/chat-task-loop-upgrade.spec.ts',
    ],
  }),
  task({
    id: 'P1-09',
    title: 'Task Loop failure repair evidence',
    implementationStatus: 'done',
    lane: 'task-loop',
    sourceOfTruth: 'Task Loop controller and provider-free repair tests',
    safeClaim: 'Task Loop owns repair, checkpoint, blocked, and evidence-gate semantics.',
    forbiddenClaim: 'Task Loop repair evidence applies to ordinary Chat failures.',
    nextAction: 'Add real-provider heavy E2E only before claiming provider E2E repair.',
    boundaryRefs: ['tests/unit/task-loop-controller.test.ts', 'tests/integration/loop-stability-check.test.ts'],
  }),
  task({
    id: 'P1-10',
    title: 'Transcript secret persistence policy',
    implementationStatus: 'done',
    lane: 'sensitive-boundary',
    sourceOfTruth: 'transcript redaction policy',
    safeClaim: 'Transcript fake-key redaction has local persistence-policy evidence.',
    forbiddenClaim: 'Real chat transcript storage is globally secret-free.',
    nextAction: 'Use E2E only before upgrading to real-runtime secret guarantees.',
    boundaryRefs: ['shared/sensitive-content-boundary.ts', 'tests/unit/sensitive-content-boundary.test.ts'],
  }),
  task({
    id: 'P1-11',
    title: 'Patch and diff secret projection',
    implementationStatus: 'done',
    lane: 'sensitive-boundary',
    sourceOfTruth: 'code-review runtime prompt redacted projection',
    safeClaim: 'Diffs sent to code-review runtime prompts redact fake-key-shaped content.',
    forbiddenClaim: 'Raw files, raw Git diffs, or copy-patch UI are always redacted.',
    nextAction: 'Keep raw and projection surfaces separate.',
    boundaryRefs: ['electron/services/code-review-api.ts', 'tests/unit/code-review-center.test.ts'],
  }),
  task({
    id: 'P1-12',
    title: 'Compaction artifact secret safeguard',
    implementationStatus: 'done',
    lane: 'sensitive-boundary',
    sourceOfTruth: 'deterministic compaction artifact/projection',
    safeClaim: 'Compaction artifact and recovery projection redact fake-key-shaped content.',
    forbiddenClaim: 'Provider-generated summaries and model echoes are globally secret-free.',
    nextAction: 'Do not extend this claim beyond deterministic artifact surfaces.',
    boundaryRefs: ['openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts', 'tests/unit/compression-artifact.test.ts'],
  }),
  task({
    id: 'P1-13',
    title: 'Memory secret-like proposal verification',
    implementationStatus: 'done',
    lane: 'sensitive-boundary',
    sourceOfTruth: 'memory.propose Gateway handler and SQLite feedback',
    safeClaim: 'memory.propose rejects fake-key-shaped proposals without returning the full fake key.',
    forbiddenClaim: 'The full Electron/WebSocket/provider memory path is proven secret-free.',
    nextAction: 'Add UI/WebSocket E2E only before claiming end-to-end behavior.',
    boundaryRefs: ['openclaw_runtime/src/memory/memory-store.ts', 'tests/unit/role-orchestration-methods.test.ts'],
  }),
  task({
    id: 'P1-14',
    title: 'Sensitive content boundary matrix',
    implementationStatus: 'done',
    lane: 'sensitive-boundary',
    sourceOfTruth: 'shared sensitive-content boundary matrix',
    safeClaim: 'file, transcript, trace, memory, compaction, and model echo surfaces have separate guarantees.',
    forbiddenClaim: 'The full chain guarantees no sensitive plaintext anywhere.',
    nextAction: 'Keep each sensitive surface tested and claimed separately.',
    boundaryRefs: ['shared/sensitive-content-boundary.ts', 'tests/unit/sensitive-content-boundary.test.ts'],
  }),
] as const satisfies readonly ProductSemanticTaskBoundary[];

export type OrchestrationQualityState = null | 'shadow' | 'active';

export function normalizeOrchestrationQualityState(value: unknown): OrchestrationQualityState {
  if (value === 'shadow' || value === 'active') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const state = (value as { state?: unknown; status?: unknown }).state
      ?? (value as { state?: unknown; status?: unknown }).status;
    if (state === 'shadow' || state === 'active') return state;
  }
  return null;
}

export function orchestrationQualityAffectsRouting(state: OrchestrationQualityState): boolean {
  return state === 'active';
}

export type PermissionDecisionBoundary =
  | 'user-file'
  | 'system-metadata'
  | 'workspace-command'
  | 'gateway-rpc'
  | 'role-tool'
  | 'provider-call'
  | 'unknown';

export type PermissionDecisionEvent = {
  kind: 'permission-decision';
  workspaceMode: WorkspacePermissionMode | 'unknown';
  role: string | null;
  tool: string | null;
  boundary: PermissionDecisionBoundary;
  decision: 'allow' | 'deny' | 'approval-required';
  reason: string;
  requestId: string | null;
};

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createPermissionDecisionEvent(input: {
  workspaceMode?: WorkspacePermissionMode | null;
  role?: string | null;
  tool?: string | null;
  boundary?: PermissionDecisionBoundary | null;
  decision: PermissionDecisionEvent['decision'];
  reason?: string | null;
  requestId?: string | null;
}): PermissionDecisionEvent {
  return {
    kind: 'permission-decision',
    workspaceMode: input.workspaceMode ?? 'unknown',
    role: normalizeOptionalText(input.role),
    tool: normalizeOptionalText(input.tool),
    boundary: input.boundary ?? 'unknown',
    decision: input.decision,
    reason: normalizeOptionalText(input.reason) ?? 'No reason recorded',
    requestId: normalizeOptionalText(input.requestId),
  };
}

export function createTaskLedgerReference(input: {
  taskLedgerNodeId: string;
  workboardCardId?: string | null;
  source?: TaskLedgerReference['source'];
}): TaskLedgerReference {
  return createCanonicalTaskLedgerReference(input);
}

export type TaskLoopUpgradeSuggestion = {
  kind: 'task-loop-upgrade-suggestion';
  sessionId: string;
  taskTitle: string;
  reason: string;
  requiresUserConfirmation: true;
  createsTaskLedgerRoot: true;
  startsRun: 'after-user-confirmation';
};

export function createTaskLoopUpgradeSuggestion(input: {
  sessionId: string;
  taskTitle: string;
  reason: string;
}): TaskLoopUpgradeSuggestion {
  return {
    kind: 'task-loop-upgrade-suggestion',
    sessionId: input.sessionId.trim(),
    taskTitle: input.taskTitle.trim(),
    reason: input.reason.trim(),
    requiresUserConfirmation: true,
    createsTaskLedgerRoot: true,
    startsRun: 'after-user-confirmation',
  };
}
