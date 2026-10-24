export const CAPABILITY_CLAIM_CLASSIFICATIONS = [
  'TP-RUN',
  'TP-TEST',
  'TP-SRC',
  'TP-SRC/TP-TEST',
  'TP-SRC + FP-NOT-RUNNABLE',
  'TP-RUN + PARTIAL',
  'TP-TEST + PARTIAL',
  'PARTIAL',
  'PARTIAL/FP-OVERCLAIM',
  'PARTIAL/FP-NOT-RUNNABLE',
  'FP-OVERCLAIM',
] as const;

export const CAPABILITY_CLAIM_RUNTIME_STATUSES = [
  'real-runtime-verified',
  'test-verified',
  'source-verified',
  'partial',
  'not-runnable',
  'not-guaranteed',
] as const;

export const CAPABILITY_CLAIM_EVIDENCE_LEVELS = [
  'real-runtime',
  'unit-test',
  'e2e',
  'source',
  'negative-runtime',
  'documented-boundary',
] as const;

export type CapabilityClaimClassification = typeof CAPABILITY_CLAIM_CLASSIFICATIONS[number];
export type CapabilityClaimRuntimeStatus = typeof CAPABILITY_CLAIM_RUNTIME_STATUSES[number];
export type CapabilityClaimEvidenceLevel = typeof CAPABILITY_CLAIM_EVIDENCE_LEVELS[number];

export type CapabilityClaimEvidence = {
  level: CapabilityClaimEvidenceLevel;
  summary: string;
  refs: string[];
};

export type CapabilityClaimUserPath = {
  surface: string;
  entrypoint: string;
  boundary: string;
};

export type CapabilityClaimRuntimeProof = {
  status: CapabilityClaimRuntimeStatus;
  summary: string;
  refs: string[];
  lastVerifiedAt?: string;
};

export type CapabilityClaimMatrixEntry = {
  id: `capability-${string}`;
  reportItem: number;
  title: string;
  classification: CapabilityClaimClassification;
  claim: {
    safe: string;
    unsafe: string;
  };
  evidence: CapabilityClaimEvidence[];
  userPath: CapabilityClaimUserPath;
  runtimeProof: CapabilityClaimRuntimeProof;
  knownExclusions: string[];
  relatedTaskIds: string[];
};

const MATRIX_REPORT = 'reports/report-authenticity-true-false-positive-matrix-2026-07-04.md';
const RUNTIME_REPORT = 'reports/real-runtime-task-validation-2026-07-04.md';
const SENSITIVE_BOUNDARY_MATRIX = 'shared/sensitive-content-boundary.ts';
const RELIABILITY_BOUNDARY_MATRIX = 'shared/reliability-boundaries.ts';

function evidence(
  level: CapabilityClaimEvidenceLevel,
  summary: string,
  refs: string[],
): CapabilityClaimEvidence {
  return { level, summary, refs };
}

function entry(input: CapabilityClaimMatrixEntry): CapabilityClaimMatrixEntry {
  return input;
}

export const CAPABILITY_CLAIM_MATRIX = [
  entry({
    id: 'capability-01',
    reportItem: 1,
    title: 'User input entering an explicit Plan state machine',
    classification: 'PARTIAL',
    claim: {
      safe: 'Ordinary Chat input enters the chat.send execution path; Plan/read-only mode is a permission boundary.',
      unsafe: 'Ordinary Chat always enters a separate editable Plan state machine.',
    },
    evidence: [
      evidence('real-runtime', 'The core chat.send path was exercised in the real runtime validation.', [RUNTIME_REPORT]),
      evidence('documented-boundary', 'The matrix records Plan/read-only as a permission mode, not a standalone editable state machine.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Chat',
      entrypoint: 'Send a normal chat message',
      boundary: 'Plan mode affects permissions; it does not create a complete editable plan workflow.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Core chat execution is verified, while the independent Plan state machine claim is not verified.',
      refs: [RUNTIME_REPORT, MATRIX_REPORT],
      lastVerifiedAt: '2026-07-04',
    },
    knownExclusions: [
      'No verified standalone editable Plan state machine for ordinary Chat.',
      'Plan/read-only should not be described as full plan orchestration.',
    ],
    relatedTaskIds: ['P1-01', 'P1-02'],
  }),
  entry({
    id: 'capability-02',
    reportItem: 2,
    title: 'Automatic decomposition and multi-role assignment',
    classification: 'PARTIAL',
    claim: {
      safe: 'Role decomposition is available through orchestrator, team_orchestrate, or explicit Task Loop paths.',
      unsafe: 'Every ordinary Chat message is automatically decomposed and assigned to multiple roles.',
    },
    evidence: [
      evidence('source', 'Role orchestration and team paths exist in runtime code.', ['openclaw_runtime/src/agents/orchestrator.ts', 'openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts']),
      evidence('documented-boundary', 'The matrix limits this claim to explicit orchestration paths.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Chat or Agents',
      entrypoint: 'Use explicit orchestration or Task Loop entrypoints',
      boundary: 'Ordinary Chat is not forced through multi-role orchestration.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Source paths exist; default ordinary Chat automation is not proven.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No claim that simple Chat always invokes multiple role workers.',
      'No default automatic role assignment guarantee for all prompts.',
    ],
    relatedTaskIds: ['P1-04', 'P1-05'],
  }),
  entry({
    id: 'capability-03',
    reportItem: 3,
    title: 'Workspace automatically creates projects, installs dependencies, and executes',
    classification: 'PARTIAL',
    claim: {
      safe: 'Workspace, terminal, and file gates allow the agent to perform project actions when explicitly used and permitted.',
      unsafe: 'The product provides one automatic flow that always creates projects, installs dependencies, and executes them.',
    },
    evidence: [
      evidence('unit-test', 'Workspace permission behavior is covered by unit tests.', ['tests/unit/workspace-permissions.test.ts']),
      evidence('documented-boundary', 'The report states the tool capability exists but is not a unified automatic product flow.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Workspace tools',
      entrypoint: 'Agent tool use with workspace permissions',
      boundary: 'Automation depends on tool calls and permissions; there is no single guaranteed project bootstrap flow.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Permission gates are tested; the full automatic product flow is not established.',
      refs: ['tests/unit/workspace-permissions.test.ts', MATRIX_REPORT],
    },
    knownExclusions: [
      'No guarantee that every task installs dependencies automatically.',
      'No guarantee that workspace bootstrap succeeds without explicit tool execution.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-04',
    reportItem: 4,
    title: 'Trace and event graph existence',
    classification: 'TP-SRC + FP-NOT-RUNNABLE',
    claim: {
      safe: 'Trace types, recorder, and UI code exist, but real task queryTraces returned no trace items in validation.',
      unsafe: 'Trace is fully queryable for real tasks today.',
    },
    evidence: [
      evidence('source', 'Observability trace source exists.', ['openclaw_runtime/src/observability/trace-recorder.ts', 'shared/types/observability.ts']),
      evidence('negative-runtime', 'Three real repair rounds returned traceItems=0.', [RUNTIME_REPORT, MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Observability or trace UI/API',
      entrypoint: 'Query traces by runId, sessionKey, or workspace',
      boundary: 'The source exists, but real runtime queryability failed in the latest validation.',
    },
    runtimeProof: {
      status: 'not-runnable',
      summary: 'Real runtime validation found zero queryable trace items.',
      refs: [RUNTIME_REPORT],
      lastVerifiedAt: '2026-07-04',
    },
    knownExclusions: [
      'Do not claim real task traces are currently queryable.',
      'Trace source existence is not runtime proof.',
    ],
    relatedTaskIds: ['P0-06', 'P0-07'],
  }),
  entry({
    id: 'capability-05',
    reportItem: 5,
    title: 'Work panel displays plan or execution graph with status updates',
    classification: 'PARTIAL',
    claim: {
      safe: 'Execution graph and plan view code can display partial state.',
      unsafe: 'The work panel is a complete live audit graph for real tasks.',
    },
    evidence: [
      evidence('source', 'Execution graph projection and UI files exist.', ['src/pages/Chat/ExecutionGraphCard.tsx', 'src/pages/Chat/execution-projection.ts']),
      evidence('documented-boundary', 'The report records incomplete real graph coverage.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Chat work panel',
      entrypoint: 'Open a chat run that emits graph/projection events',
      boundary: 'The graph can show partial state but is not full runtime audit proof.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'UI/source paths exist; complete real runtime graph coverage is not proven.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No full audit-chain guarantee.',
      'No claim that every tool result and final assistant response is graph-bound.',
    ],
    relatedTaskIds: ['P0-09'],
  }),
  entry({
    id: 'capability-06',
    reportItem: 6,
    title: 'Completion writes final assistant message and completion state',
    classification: 'TP-RUN + PARTIAL',
    claim: {
      safe: 'Real repair transcripts contain final summaries; standardized runtime evidence can recover startup-window history from session transcript artifacts.',
      unsafe: 'Final assistant state is always immediately available through chat.history.',
    },
    evidence: [
      evidence('real-runtime', 'The real validation found final summaries in transcripts and the standardized report records history 3/3 pass.', [MATRIX_REPORT]),
      evidence('negative-runtime', 'Round 1 direct chat.history failed during Gateway startup before transcript artifact recovery.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Chat history',
      entrypoint: 'Read current session history after a run',
      boundary: 'Post-run transcript proof exists and can recover startup-window observation; direct Gateway startup history can still be unavailable.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Completion proof exists in transcripts and standardized evidence recovers startup-window history; direct chat.history startup RPC is not guaranteed.',
      refs: [MATRIX_REPORT],
      lastVerifiedAt: '2026-07-05',
    },
    knownExclusions: [
      'No guarantee that chat.history is immediately readable during Gateway startup.',
      'Transcript artifact recovery should be distinguished from direct RPC immediacy.',
    ],
    relatedTaskIds: ['P0-08'],
  }),
  entry({
    id: 'capability-07',
    reportItem: 7,
    title: 'Editable Chat task DAG',
    classification: 'FP-OVERCLAIM',
    claim: {
      safe: 'Task Ledger and Workboard have adjacent task-graph concepts; Chat plan rendering is read-only.',
      unsafe: 'Chat exposes an editable Chat DAG with dependency editing.',
    },
    evidence: [
      evidence('documented-boundary', 'The report marks editable Chat DAG as an overclaim.', [MATRIX_REPORT]),
      evidence('source', 'Chat plan rendering and Task Ledger are separate surfaces.', ['src/components/task-ledger/TaskLedgerSummaryPanel.tsx', 'src/pages/Chat/index.tsx']),
    ],
    userPath: {
      surface: 'Chat',
      entrypoint: 'View orchestration plan rendering',
      boundary: 'Chat does not expose editable DAG dependency controls.',
    },
    runtimeProof: {
      status: 'not-guaranteed',
      summary: 'No verified Chat UI path for editable DAG behavior.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'Chat does not expose editable DAG add/remove edge controls.',
      'Task Ledger graph concepts must not be represented as Chat DAG editing.',
    ],
    relatedTaskIds: ['P1-01', 'P1-02'],
  }),
  entry({
    id: 'capability-08',
    reportItem: 8,
    title: 'Confirmed plan persists and can be restored',
    classification: 'PARTIAL',
    claim: {
      safe: 'Task Loop checkpoints can persist recovery anchors for long tasks.',
      unsafe: 'Ordinary Chat orchestration plans persist as editable restorable DAGs.',
    },
    evidence: [
      evidence('unit-test', 'Task Loop checkpoint behavior has unit coverage.', ['tests/unit/task-loop-controller.test.ts']),
      evidence('documented-boundary', 'The report limits persistence claims to long-task checkpoint paths.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Task Loop',
      entrypoint: 'Run an explicit long task or loop',
      boundary: 'Ordinary Chat plan persistence as editable DAG is not proven.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Task Loop checkpoint source/test paths exist; ordinary Chat plan persistence is unproven.',
      refs: ['tests/unit/task-loop-controller.test.ts', MATRIX_REPORT],
    },
    knownExclusions: [
      'No editable Chat DAG restore guarantee.',
      'No claim that every displayed Chat plan is durable workflow state.',
    ],
    relatedTaskIds: ['P1-01', 'P1-03'],
  }),
  entry({
    id: 'capability-09',
    reportItem: 9,
    title: 'Plan stage supports structured diff and incremental editing',
    classification: 'PARTIAL',
    claim: {
      safe: 'Long-task intervention supports guide, queue, interrupt, and revise-style controls.',
      unsafe: 'Chat plan has a structured plan-diff editor.',
    },
    evidence: [
      evidence('source', 'Long-task control store and Task Loop intervention paths exist.', ['openclaw_runtime/src/agents/long-task-control/store.ts', 'openclaw_runtime/src/agents/task-loop-controller.ts']),
      evidence('documented-boundary', 'The report identifies this as partial and scoped to long tasks.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Long task controls',
      entrypoint: 'Guide, queue, interrupt, or revise a long task',
      boundary: 'These controls are not a general Chat plan diff editor.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Long-task source paths exist; Chat structured plan editing is not verified.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No general plan diff editor in Chat.',
      'No verified dependency-edit persistence for Chat plans.',
    ],
    relatedTaskIds: ['P1-02'],
  }),
  entry({
    id: 'capability-10',
    reportItem: 10,
    title: 'Built-in roles and responsibilities exist',
    classification: 'TP-SRC/TP-TEST',
    claim: {
      safe: 'Built-in roles such as planner, architect, implementer, tester, reviewer, security, docs, and skeptic exist.',
      unsafe: 'Every Chat request is forced through all built-in roles.',
    },
    evidence: [
      evidence('source', 'Role registry and role contracts exist in runtime code.', ['openclaw_runtime/src/agents/role-registry.ts', 'openclaw_runtime/src/agents/role-contract.ts']),
      evidence('unit-test', 'Role orchestration tests cover role behavior.', ['tests/unit/role-orchestration-methods.test.ts', 'tests/unit/role-spawn.test.ts']),
    ],
    userPath: {
      surface: 'Agents and orchestration',
      entrypoint: 'Invoke role orchestration or role-aware tools',
      boundary: 'Role existence is not the same as mandatory role use for every Chat turn.',
    },
    runtimeProof: {
      status: 'test-verified',
      summary: 'Source and unit tests support role existence.',
      refs: ['tests/unit/role-orchestration-methods.test.ts', 'tests/unit/role-spawn.test.ts'],
    },
    knownExclusions: [
      'No claim that every prompt uses every role.',
      'No automatic role quality learning claim from this evidence.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-11',
    reportItem: 11,
    title: 'Dynamic role elimination or learning from performance',
    classification: 'PARTIAL',
    claim: {
      safe: 'Routing Memo is default-off and accepts active quality only from same-session Task Loop scorecard authority; ordinary orchestration remains shadow-only.',
      unsafe: 'Roles are automatically eliminated or learned from live performance by default.',
    },
    evidence: [
      evidence('unit-test', 'Routing Memo scoring has unit coverage.', ['tests/unit/routing-memo.test.ts']),
      evidence('documented-boundary', 'The report marks automatic role learning as partial.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Routing Memo diagnostics',
      entrypoint: 'Enable or inspect routing memo behavior',
      boundary: 'Default-off scoring is not automatic live role learning.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Authority gating and bounded scoring are tested; default automatic role learning is still not enabled.',
      refs: ['tests/unit/routing-memo.test.ts', 'tests/integration/p1-orchestration-boundary.integration.test.ts', MATRIX_REPORT],
    },
    knownExclusions: [
      'No default automatic role elimination.',
      'No cross-session or caller-forged quality authority.',
    ],
    relatedTaskIds: ['P1-06', 'P1-07'],
  }),
  entry({
    id: 'capability-12',
    reportItem: 12,
    title: 'Subagents isolate context and avoid full leakage',
    classification: 'PARTIAL',
    claim: {
      safe: 'Subagent isolation, fork behavior, role context, and memory context mechanisms exist.',
      unsafe: 'The system guarantees globally minimal context leakage for every subagent.',
    },
    evidence: [
      evidence('source', 'Subagent and role context source paths exist.', ['openclaw_runtime/src/agents/acp-spawn.ts', 'openclaw_runtime/src/context-engine/memory-context-provider.ts']),
      evidence('documented-boundary', 'The report warns against absolute minimal leakage claims.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Role or subagent orchestration',
      entrypoint: 'Spawn or route work to role workers',
      boundary: 'Isolation mechanisms exist, but minimal leakage is not globally proven.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Source paths support isolation mechanisms; global minimal leakage is not proven.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No absolute guarantee of least possible context.',
      'No full-chain sensitive data non-disclosure guarantee.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-13',
    reportItem: 13,
    title: 'Role-level tool permissions intercept tool use',
    classification: 'TP-TEST + PARTIAL',
    claim: {
      safe: 'Tool-level allow/deny exists and is tested for role permissions.',
      unsafe: 'The system enforces complete semantic argument-level permissions and unified audit everywhere.',
    },
    evidence: [
      evidence('unit-test', 'Role permission tests cover allow/deny behavior.', ['tests/unit/role-orchestration-methods.test.ts', 'tests/unit/role-spawn.test.ts']),
      evidence('documented-boundary', 'The report identifies command argument-level and unified audit gaps.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Role orchestration',
      entrypoint: 'Run tools under a role contract',
      boundary: 'Tool-level policy is verified; semantic and audit coverage remain partial.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Unit tests verify tool-level policy; unified audit is still missing.',
      refs: ['tests/unit/role-orchestration-methods.test.ts', MATRIX_REPORT],
    },
    knownExclusions: [
      'No complete command-argument semantic permission guarantee.',
      'No unified permission audit event across all permission systems yet.',
    ],
    relatedTaskIds: ['P0-13'],
  }),
  entry({
    id: 'capability-14',
    reportItem: 14,
    title: 'User custom or temporary roles exist',
    classification: 'PARTIAL',
    claim: {
      safe: 'Configured roles and role origin badges exist.',
      unsafe: 'A complete productized role manager and automatic temporary-role lifecycle are proven.',
    },
    evidence: [
      evidence('source', 'Role UI and shared role types exist.', ['src/components/agents/RoleCard.tsx', 'shared/types/agent.ts']),
      evidence('e2e', 'Role origin badge has E2E coverage.', ['tests/e2e/role-origin-badge.spec.ts']),
    ],
    userPath: {
      surface: 'Agents roles UI',
      entrypoint: 'View configured roles and their origin badges',
      boundary: 'Configuration and badges are not a complete role management product.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Role configuration surfaces exist; full manager lifecycle is not proven.',
      refs: ['tests/e2e/role-origin-badge.spec.ts', MATRIX_REPORT],
    },
    knownExclusions: [
      'No complete create/edit/delete/test role manager proof.',
      'No automatic temporary role lifecycle guarantee.',
    ],
    relatedTaskIds: ['P2-05'],
  }),
  entry({
    id: 'capability-15',
    reportItem: 15,
    title: 'Worker outputs have quality scores that feed routing',
    classification: 'PARTIAL/FP-OVERCLAIM',
    claim: {
      safe: 'Task Loop has evidence and self-check paths; ordinary team_orchestrate quality can be empty.',
      unsafe: 'Ordinary team_orchestrate always returns complete quality scoring and feeds routing.',
    },
    evidence: [
      evidence('unit-test', 'Task Loop evidence and repair paths have unit coverage.', ['tests/unit/task-loop-controller.test.ts']),
      evidence('negative-runtime', 'The report records ordinary team_orchestrate quality: [] as a counterexample.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Task Loop or team orchestration',
      entrypoint: 'Run explicit Task Loop for richer evidence, or team_orchestrate for ordinary orchestration',
      boundary: 'Task Loop quality paths must not be projected onto ordinary orchestration.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Task Loop path is supported; ordinary orchestration quality is incomplete.',
      refs: ['tests/unit/task-loop-controller.test.ts', MATRIX_REPORT],
    },
    knownExclusions: [
      'No complete ordinary team_orchestrate quality array guarantee.',
      'No verified routing feedback loop from ordinary worker quality.',
    ],
    relatedTaskIds: ['P1-04', 'P1-05', 'P1-07'],
  }),
  entry({
    id: 'capability-16',
    reportItem: 16,
    title: 'Electron starts and manages Gateway',
    classification: 'TP-RUN',
    claim: {
      safe: 'Real runtime validation confirms Electron app startup and Gateway readiness.',
      unsafe: 'Gateway readiness proves every advanced runtime feature is complete.',
    },
    evidence: [
      evidence('real-runtime', 'The validation report records app.started=true and gatewayReady=true.', [RUNTIME_REPORT]),
      evidence('source', 'Gateway manager source exists in Electron.', ['electron/gateway/manager.ts']),
    ],
    userPath: {
      surface: 'Application startup',
      entrypoint: 'Launch the Electron app',
      boundary: 'Startup readiness is not evidence for unrelated advanced claims.',
    },
    runtimeProof: {
      status: 'real-runtime-verified',
      summary: 'Electron App and Gateway readiness were observed in real validation.',
      refs: [RUNTIME_REPORT],
      lastVerifiedAt: '2026-07-04',
    },
    knownExclusions: [
      'No claim that all Gateway methods are fully validated.',
      'No claim that observability query worked.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-17',
    reportItem: 17,
    title: 'Exit cleans Gateway, extensions, and connections',
    classification: 'TP-SRC',
    claim: {
      safe: 'Source contains best-effort teardown, stop, and kill behavior.',
      unsafe: 'Crash-grade cleanup is proven by E2E.',
    },
    evidence: [
      evidence('source', 'Electron and Gateway shutdown paths exist.', ['electron/gateway/manager.ts', 'electron/main/index.ts']),
      evidence('documented-boundary', 'The report states this is source-verified best effort only.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Application shutdown',
      entrypoint: 'Quit the Electron app',
      boundary: 'Best-effort cleanup is not crash-grade cleanup proof.',
    },
    runtimeProof: {
      status: 'source-verified',
      summary: 'Cleanup code exists, but destructive/crash E2E was not run.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No crash recovery cleanup E2E proof.',
      'No guarantee every extension process is always cleaned in abnormal exits.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-18',
    reportItem: 18,
    title: 'Avoid Workspace and Runtime dependency cycles',
    classification: 'PARTIAL',
    claim: {
      safe: 'Gateway/host API boundaries and subagent depth limits reduce cycle risk.',
      unsafe: 'The architecture has a formal proof of no Workspace/Runtime cycles.',
    },
    evidence: [
      evidence('source', 'Gateway, host API, and subagent depth-related source paths exist.', ['src/lib/host-api.ts', 'openclaw_runtime/src/agents/acp-spawn.ts']),
      evidence('documented-boundary', 'The matrix marks this as architectural partial evidence.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Runtime and workspace integration',
      entrypoint: 'Use host API mediated calls',
      boundary: 'Architectural boundaries reduce risk but are not formal no-cycle proof.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Boundary source exists; formal cycle proof is absent.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No formal acyclic dependency proof.',
      'No global guarantee that future integrations cannot introduce cycles.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-19',
    reportItem: 19,
    title: 'Communication is async JSON-RPC with timeout',
    classification: 'TP-RUN',
    claim: {
      safe: 'Gateway manager pending/timeout behavior exists and real smoke chat.send ACK succeeded.',
      unsafe: 'Every communication path has identical timeout and retry semantics.',
    },
    evidence: [
      evidence('source', 'Gateway manager implements pending and timeout behavior.', ['electron/gateway/manager.ts']),
      evidence('real-runtime', 'Real smoke chat.send received Gateway ACK in about 961ms.', [RUNTIME_REPORT]),
    ],
    userPath: {
      surface: 'Chat/Gateway RPC',
      entrypoint: 'Send chat.send through Gateway',
      boundary: 'Validated path is core chat RPC, not every possible transport path.',
    },
    runtimeProof: {
      status: 'real-runtime-verified',
      summary: 'Core async RPC path was validated by real smoke ACK.',
      refs: [RUNTIME_REPORT],
      lastVerifiedAt: '2026-07-04',
    },
    knownExclusions: [
      'No claim of global uniform retry semantics.',
      'No claim that all plugin or external channel calls share identical timeout policy.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-20',
    reportItem: 20,
    title: 'Observability failure does not block task execution',
    classification: 'TP-RUN',
    claim: {
      safe: 'Real repair succeeded even though trace query returned no items.',
      unsafe: 'Observability is complete because core execution succeeded.',
    },
    evidence: [
      evidence('real-runtime', 'Three repair rounds succeeded while traceItems=0.', [RUNTIME_REPORT, MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Core agent execution',
      entrypoint: 'Run a real repair task',
      boundary: 'Core execution can pass while observability remains incomplete.',
    },
    runtimeProof: {
      status: 'real-runtime-verified',
      summary: 'Repair success and trace failure were observed together.',
      refs: [RUNTIME_REPORT, MATRIX_REPORT],
      lastVerifiedAt: '2026-07-04',
    },
    knownExclusions: [
      'Do not convert execution success into trace completeness.',
      'Do not hide observability failures behind core execution success.',
    ],
    relatedTaskIds: ['P0-06', 'P0-10'],
  }),
  entry({
    id: 'capability-21',
    reportItem: 21,
    title: 'Task failure automatically performs full rollback',
    classification: 'FP-OVERCLAIM',
    claim: {
      safe: 'Rollback plan, checkpoint, and replay helpers exist as auxiliary mechanisms.',
      unsafe: 'Any task failure automatically performs full file transaction rollback.',
    },
    evidence: [
      evidence('source', 'Rollback plan code exists.', ['src/pages/Chat/rollback-plan.ts']),
      evidence('documented-boundary', 'The report marks full automatic rollback as an overclaim.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Task recovery helpers',
      entrypoint: 'Use review, restore, or replay-oriented flows where available',
      boundary: 'There is no global file transaction snapshot rollback.',
    },
    runtimeProof: {
      status: 'not-guaranteed',
      summary: 'No real runtime or source proof of global automatic rollback.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No global file transaction snapshot.',
      'No automatic rollback guarantee for arbitrary failed commands or edits.',
    ],
    relatedTaskIds: ['P2-02'],
  }),
  entry({
    id: 'capability-22',
    reportItem: 22,
    title: 'Global idempotency strategy',
    classification: 'PARTIAL',
    claim: {
      safe: 'Some chat, checkpoint, and intervention paths have local idempotency behavior.',
      unsafe: 'The product has a global idempotency framework for files and commands.',
    },
    evidence: [
      evidence('source', 'Checkpoint and intervention source paths exist.', ['openclaw_runtime/src/gateway/session-compaction-checkpoints.ts', 'openclaw_runtime/src/agents/long-task-control/store.ts']),
      evidence('source', 'P2-06 reliability matrix scopes local idempotency and excludes global file/command guarantees.', [RELIABILITY_BOUNDARY_MATRIX]),
      evidence('documented-boundary', 'The report says file and command operations do not have global idempotency.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Chat and long-task recovery',
      entrypoint: 'Use checkpoint or intervention flows',
      boundary: 'Local idempotency does not cover arbitrary file/command side effects.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Local mechanisms exist; global idempotency is not proven.',
      refs: [MATRIX_REPORT, RELIABILITY_BOUNDARY_MATRIX],
    },
    knownExclusions: [
      'No global command idempotency guarantee.',
      'No global filesystem mutation idempotency guarantee.',
    ],
    relatedTaskIds: ['P2-06'],
  }),
  entry({
    id: 'capability-23',
    reportItem: 23,
    title: 'User intervention during long tasks',
    classification: 'TP-SRC/TP-TEST',
    claim: {
      safe: 'Long-task input modes support guide, queue, interrupt, and revise-goal semantics.',
      unsafe: 'All ordinary Chat turns have the same long-task intervention model.',
    },
    evidence: [
      evidence('source', 'Long-task control source exists.', ['openclaw_runtime/src/agents/long-task-control/store.ts']),
      evidence('unit-test', 'Long-task control E2E/unit paths are tracked in chat long-task tests.', ['tests/e2e/chat-long-task-control.spec.ts', 'tests/unit/task-loop-controller.test.ts']),
    ],
    userPath: {
      surface: 'Long-task controls',
      entrypoint: 'Interact with an active long task',
      boundary: 'The claim is scoped to explicit long-task or Task Loop contexts.',
    },
    runtimeProof: {
      status: 'test-verified',
      summary: 'Source and tests support long-task intervention behavior.',
      refs: ['tests/e2e/chat-long-task-control.spec.ts', 'tests/unit/task-loop-controller.test.ts'],
    },
    knownExclusions: [
      'No claim that every ordinary Chat request is interruptible through long-task semantics.',
      'No claim that ClawGraph active node rewrite is automatic.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-24',
    reportItem: 24,
    title: 'Checkpoint stores full context and file snapshot',
    classification: 'FP-OVERCLAIM',
    claim: {
      safe: 'Checkpoint stores recovery summaries and anchors.',
      unsafe: 'Checkpoint stores complete context, complete tool history, and full filesystem snapshot.',
    },
    evidence: [
      evidence('unit-test', 'Task Loop checkpoint unit paths exist.', ['tests/unit/task-loop-controller.test.ts']),
      evidence('documented-boundary', 'The report marks full snapshot language as an overclaim.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Task Loop checkpoint recovery',
      entrypoint: 'Resume from checkpoint or inspect recovery context',
      boundary: 'Recovery anchor is not a full context or filesystem snapshot.',
    },
    runtimeProof: {
      status: 'not-guaranteed',
      summary: 'No proof that checkpoints contain complete context or file snapshots.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No complete tool history storage guarantee.',
      'No filesystem snapshot guarantee.',
    ],
    relatedTaskIds: ['P2-01'],
  }),
  entry({
    id: 'capability-25',
    reportItem: 25,
    title: 'Approval automatically passes without feedback',
    classification: 'TP-SRC',
    claim: {
      safe: 'Source indicates pending, TTL, or block style approval behavior rather than silent auto-pass.',
      unsafe: 'Missing approval feedback automatically approves actions.',
    },
    evidence: [
      evidence('source', 'Permission and approval related services exist.', ['electron/services/permissions-api.ts', 'electron/utils/workspace-runtime-permissions.ts']),
      evidence('documented-boundary', 'The report found no auto-pass behavior and requests UI supplementation.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Approval prompts',
      entrypoint: 'Trigger a permissioned action that requires approval',
      boundary: 'Needs real UI scenario proof; no silent auto-pass claim.',
    },
    runtimeProof: {
      status: 'source-verified',
      summary: 'Source-level evidence suggests pending/block behavior, with UI proof still needed.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No verified UI scenario for all approval timeouts.',
      'No claim of auto-approval on silence.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-26',
    reportItem: 26,
    title: 'Unified retry and fallback',
    classification: 'PARTIAL',
    claim: {
      safe: 'Model fallback, Gateway reconnect, and web timeout style mechanisms exist locally.',
      unsafe: 'All subsystems share one unified retry and fallback policy.',
    },
    evidence: [
      evidence('source', 'Gateway manager and provider transport fallback-related source paths exist.', ['electron/gateway/manager.ts', 'openclaw_runtime/src/agents/provider-transport-fetch.ts']),
      evidence('source', 'P2-06 reliability matrix separates Gateway startup, provider fallback, host API, recovery, file write, approval, and Task Loop retry boundaries.', [RELIABILITY_BOUNDARY_MATRIX]),
      evidence('documented-boundary', 'The report scopes this to local mechanisms.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Runtime communication and provider calls',
      entrypoint: 'Use chat or provider backed execution',
      boundary: 'Local fallback should not be described as global policy.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Local fallback mechanisms exist; unified policy is not proven.',
      refs: [MATRIX_REPORT, RELIABILITY_BOUNDARY_MATRIX],
    },
    knownExclusions: [
      'No system-wide retry policy contract.',
      'No uniform fallback semantics across files, commands, providers, and UI.',
    ],
    relatedTaskIds: ['P2-06'],
  }),
  entry({
    id: 'capability-27',
    reportItem: 27,
    title: 'Unified token, timeout, and tool-count limits with new-session advice',
    classification: 'PARTIAL',
    claim: {
      safe: 'Token and timeout mechanisms exist, but tool-count limits and new-session advice are not a unified product loop.',
      unsafe: 'The app has one complete budget loop for token, timeout, tool count, and new-session guidance.',
    },
    evidence: [
      evidence('source', 'Token usage and context window code exists.', ['electron/utils/token-usage.ts', 'tests/unit/context-window.test.ts']),
      evidence('documented-boundary', 'The matrix records missing tool-count and user-advice closure.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Chat budget and runtime settings',
      entrypoint: 'Run chats with token/timeout constraints',
      boundary: 'Budget primitives are not yet a complete user-facing guidance loop.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Budget mechanisms exist; unified product closure is missing.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No unified tool-count limit product proof.',
      'No guaranteed new-session recommendation loop.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-28',
    reportItem: 28,
    title: 'Context pressure threshold exists',
    classification: 'TP-SRC/TP-TEST',
    claim: {
      safe: 'Compression planner and context pruning thresholds exist.',
      unsafe: 'Threshold existence proves lossless compaction.',
    },
    evidence: [
      evidence('source', 'Compaction source exists.', ['openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts']),
      evidence('unit-test', 'Context window and compression artifact tests exist.', ['tests/unit/context-window.test.ts', 'tests/unit/compression-artifact.test.ts']),
    ],
    userPath: {
      surface: 'Chat context management',
      entrypoint: 'Approach context pressure and trigger compaction/pruning behavior',
      boundary: 'Thresholds are not lossless guarantees.',
    },
    runtimeProof: {
      status: 'test-verified',
      summary: 'Source and tests support threshold existence.',
      refs: ['tests/unit/context-window.test.ts', 'tests/unit/compression-artifact.test.ts'],
    },
    knownExclusions: [
      'No lossless compaction guarantee.',
      'No guarantee that every old detail survives pruning.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-29',
    reportItem: 29,
    title: 'Compaction retention priorities',
    classification: 'TP-SRC',
    claim: {
      safe: 'Recent turns, identifiers, and rules receive protection, while older tool and lower-priority content can be cut.',
      unsafe: 'Compaction keeps all information without loss.',
    },
    evidence: [
      evidence('source', 'Compression artifact and compaction logic define retained structures.', ['openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts']),
      evidence('documented-boundary', 'The report documents retention priorities and lossy boundaries.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Compaction and recovery context',
      entrypoint: 'Inspect compacted session artifact where available',
      boundary: 'Retention priority is not complete preservation.',
    },
    runtimeProof: {
      status: 'source-verified',
      summary: 'Source defines retained structures; lossless behavior is excluded.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No no-loss compaction guarantee.',
      'Older tool content can be summarized or omitted.',
    ],
    relatedTaskIds: ['P2-04'],
  }),
  entry({
    id: 'capability-30',
    reportItem: 30,
    title: 'Compaction guarantees no drift',
    classification: 'PARTIAL',
    claim: {
      safe: 'Compaction has safeguards, quality checks, and retry behavior.',
      unsafe: 'Compaction guarantees zero drift.',
    },
    evidence: [
      evidence('unit-test', 'Compression artifact tests cover structural safeguards.', ['tests/unit/compression-artifact.test.ts']),
      evidence('documented-boundary', 'The report describes compaction as protected lossy summary.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Compaction',
      entrypoint: 'Trigger or inspect compaction output',
      boundary: 'Safeguards reduce risk but do not guarantee zero drift.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Safeguards exist; zero drift is not guaranteed.',
      refs: ['tests/unit/compression-artifact.test.ts', MATRIX_REPORT],
    },
    knownExclusions: [
      'No zero-drift guarantee.',
      'No lossless compression guarantee.',
    ],
    relatedTaskIds: ['P2-04'],
  }),
  entry({
    id: 'capability-31',
    reportItem: 31,
    title: 'User can see, confirm, and restore compaction summary',
    classification: 'PARTIAL',
    claim: {
      safe: 'Chat has compact status and manual dialog paths.',
      unsafe: 'Every automatic compaction is shown for step-by-step user confirmation and restore.',
    },
    evidence: [
      evidence('source', 'Session compression artifact and recovery APIs exist.', ['openclaw_runtime/src/gateway/session-compaction-checkpoints.ts', 'openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts']),
      evidence('documented-boundary', 'The report says manual visibility exists while automatic confirmation is not proven.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Chat context controls',
      entrypoint: 'Open compaction status or manual compaction dialog',
      boundary: 'Automatic per-compaction confirmation is not verified.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Manual visibility path exists; automatic confirmation remains unproven.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No proof of automatic compaction confirmation every time.',
      'No full restore guarantee from compacted summaries.',
    ],
    relatedTaskIds: ['P2-04'],
  }),
  entry({
    id: 'capability-32',
    reportItem: 32,
    title: 'Repeated compaction summarizes previous summaries',
    classification: 'PARTIAL',
    claim: {
      safe: 'Previous summary re-distillation and identifier audit mechanisms exist.',
      unsafe: 'Repeated compaction cannot accumulate loss.',
    },
    evidence: [
      evidence('source', 'Compaction code supports structured recovery artifacts.', ['openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts']),
      evidence('documented-boundary', 'The report excludes no-loss and hard-count guarantees.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Long conversation compaction',
      entrypoint: 'Run repeated compaction over a long session',
      boundary: 'Repeated compaction can be handled, but accumulated loss is not ruled out.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Mechanisms exist; no lossless cumulative guarantee.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No hard upper bound proof for summary degradation.',
      'No guarantee that repeated summaries preserve every detail.',
    ],
    relatedTaskIds: ['P2-04'],
  }),
  entry({
    id: 'capability-33',
    reportItem: 33,
    title: 'Memory confidence, conflict, and overwrite policy',
    classification: 'TP-TEST',
    claim: {
      safe: 'Memory proposal, review, conflict, and gatekeeper paths are tested.',
      unsafe: 'Memory automatically overwrites long-term knowledge without review.',
    },
    evidence: [
      evidence('unit-test', 'Memory API and runtime memory store tests exist.', ['tests/unit/memory-api.test.ts', 'tests/unit/runtime-memory-store.test.ts']),
      evidence('documented-boundary', 'The report allows proposal/review claims but excludes automatic overwrite claims.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Memory management',
      entrypoint: 'Propose, review, approve, or reject memory entries',
      boundary: 'Reviewed proposal flow is not automatic overwrite.',
    },
    runtimeProof: {
      status: 'test-verified',
      summary: 'Unit tests support memory proposal/review and conflict paths.',
      refs: ['tests/unit/memory-api.test.ts', 'tests/unit/runtime-memory-store.test.ts'],
    },
    knownExclusions: [
      'No automatic overwrite guarantee.',
      'No claim that every session summary is instantly committed to long-term memory.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-34',
    reportItem: 34,
    title: 'Memory retention scoring',
    classification: 'TP-SRC/TP-TEST',
    claim: {
      safe: 'Memory retention scoring for keep, cold, archive, tombstone, and review exists.',
      unsafe: 'Retention scoring proves perfect long-term memory quality.',
    },
    evidence: [
      evidence('source', 'Runtime memory store and memory persistence paths exist.', ['openclaw_runtime/src/runtime-core/memory-store.ts', 'openclaw_runtime/src/runtime-core/memory-persistence.ts']),
      evidence('unit-test', 'Runtime memory store tests exist.', ['tests/unit/runtime-memory-store.test.ts']),
    ],
    userPath: {
      surface: 'Memory runtime',
      entrypoint: 'Evaluate or persist memory records',
      boundary: 'Scoring does not guarantee perfect recall or curation.',
    },
    runtimeProof: {
      status: 'test-verified',
      summary: 'Source and tests support retention scoring existence.',
      refs: ['tests/unit/runtime-memory-store.test.ts', MATRIX_REPORT],
    },
    knownExclusions: [
      'No perfect memory quality guarantee.',
      'No automatic safe overwrite guarantee.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-35',
    reportItem: 35,
    title: 'Cross-session experience migration',
    classification: 'PARTIAL',
    claim: {
      safe: 'Memory store and context packs support cross-session context reuse in part.',
      unsafe: 'All cross-session learning and routing migration is fully active by default.',
    },
    evidence: [
      evidence('unit-test', 'Role memory context provider and runtime memory tests exist.', ['tests/unit/role-memory-context-provider.test.ts', 'tests/unit/runtime-memory-store.test.ts']),
      evidence('documented-boundary', 'Routing Memo remains default-off and should not be mixed with memory claims.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Memory context',
      entrypoint: 'Load memory context for a later session',
      boundary: 'Memory reuse is partial; routing learning is separate and default-off.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Memory reuse paths exist; full learning migration is not proven.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No default active dynamic routing learning.',
      'No guarantee every useful experience migrates across sessions.',
    ],
    relatedTaskIds: ['P2-03'],
  }),
  entry({
    id: 'capability-36',
    reportItem: 36,
    title: 'Every task automatically summarizes into memory',
    classification: 'PARTIAL',
    claim: {
      safe: 'Memory proposal sources can include session_summary and trace, using proposal-first semantics.',
      unsafe: 'Every task completion automatically commits a long-term memory summary.',
    },
    evidence: [
      evidence('source', 'Memory runtime integration source exists.', ['openclaw_runtime/src/runtime-core/memory-runtime-integration.ts']),
      evidence('documented-boundary', 'The report excludes automatic activated writes for every task.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Memory proposal/review',
      entrypoint: 'Review memory proposals created from session sources',
      boundary: 'Proposal-first does not mean automatic long-term write activation.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Proposal sources exist; automatic commit for every task is not proven.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No automatic memory commit for every task.',
      'No guarantee every session ends with an approved long-term memory entry.',
    ],
    relatedTaskIds: ['P2-03'],
  }),
  entry({
    id: 'capability-37',
    reportItem: 37,
    title: 'Task edit transaction rollback',
    classification: 'FP-OVERCLAIM',
    claim: {
      safe: 'Ordinary Chat plan does not expose a verified task-edit transaction model.',
      unsafe: 'Editing any task in Chat has transaction rollback.',
    },
    evidence: [
      evidence('documented-boundary', 'The matrix marks task edit transaction rollback as an overclaim.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Chat plan/task editing',
      entrypoint: 'No verified ordinary Chat task transaction editor',
      boundary: 'Task editing transaction rollback is not a current Chat capability.',
    },
    runtimeProof: {
      status: 'not-guaranteed',
      summary: 'No source or runtime proof of ordinary Chat task edit transaction rollback.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No ordinary Chat task edit transaction model.',
      'No rollback guarantee for plan editing.',
    ],
    relatedTaskIds: ['P1-02', 'P2-02'],
  }),
  entry({
    id: 'capability-38',
    reportItem: 38,
    title: 'Execution Graph and Trace fold, filter, and search',
    classification: 'PARTIAL/FP-NOT-RUNNABLE',
    claim: {
      safe: 'UI source and partial E2E exist for graph/trace interactions, but real trace query failed.',
      unsafe: 'The full observability chain is reliably foldable, filterable, searchable, and backed by real traces.',
    },
    evidence: [
      evidence('source', 'Execution graph UI source exists.', ['src/pages/Chat/ExecutionGraphCard.tsx']),
      evidence('negative-runtime', 'Real queryTraces returned zero trace items.', [RUNTIME_REPORT]),
    ],
    userPath: {
      surface: 'Execution Graph or Trace UI',
      entrypoint: 'Open graph/trace controls for a run',
      boundary: 'UI interactions do not prove real trace-backed completeness.',
    },
    runtimeProof: {
      status: 'not-runnable',
      summary: 'Real trace query failure prevents full runtime claim.',
      refs: [RUNTIME_REPORT, MATRIX_REPORT],
    },
    knownExclusions: [
      'No full real trace-backed search guarantee.',
      'No claim that every graph node maps to runtime tool result today.',
    ],
    relatedTaskIds: ['P0-06', 'P0-09'],
  }),
  entry({
    id: 'capability-39',
    reportItem: 39,
    title: 'UI automatically switches simplified or advanced view by user capability',
    classification: 'PARTIAL',
    claim: {
      safe: 'Different depth entrypoints exist.',
      unsafe: 'The UI automatically infers user capability and switches modes.',
    },
    evidence: [
      evidence('source', 'Multiple UI surfaces and settings panels exist.', ['src/pages/Settings/index.tsx', 'src/pages/Chat/index.tsx']),
      evidence('documented-boundary', 'The report found no automatic user-capability switching strategy.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Application UI',
      entrypoint: 'Use available simple or advanced surfaces manually',
      boundary: 'No verified automatic capability inference or mode switching.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Multiple surfaces exist; adaptive automatic switching is not proven.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No automatic user skill inference.',
      'No automatic basic/advanced switching policy proof.',
    ],
    relatedTaskIds: ['P2-07'],
  }),
  entry({
    id: 'capability-40',
    reportItem: 40,
    title: 'Observability and Memory sensitive content protection',
    classification: 'TP-TEST',
    claim: {
      safe: 'Observability redaction, transcript local redaction policy, code-review diff prompt projection redaction, compaction artifact/projection redaction, and secret-like memory rejection exist locally within documented surface boundaries.',
      unsafe: 'All transcripts, files, model echoes, traces, and compaction artifacts are guaranteed secret-free.',
    },
    evidence: [
      evidence('unit-test', 'Observability namespace/redaction and memory tests exist.', ['tests/unit/observability-namespace.test.ts', 'tests/unit/memory-api.test.ts']),
      evidence('unit-test', 'Transcript fake-key redaction helper is covered as a configurable local persistence policy.', ['tests/unit/sensitive-content-boundary.test.ts']),
      evidence('unit-test', 'memory.propose Gateway handler rejects fake keys and redacts full secret text from returned proposal feedback.', ['tests/unit/role-orchestration-methods.test.ts']),
      evidence('unit-test', 'Code-review diff prompts redact fake key-shaped content before runtime review.', ['tests/unit/code-review-center.test.ts']),
      evidence('unit-test', 'Compaction artifact, rendered summary, and recovery projection redact fake key-shaped content.', ['tests/unit/compression-artifact.test.ts']),
      evidence('unit-test', 'P1 provider-free integration smoke covers transcript, memory.propose, code-review diff prompt, compaction projection, and the no-full-chain guarantee flag.', ['tests/integration/p1-sensitive-content-boundary.integration.test.ts']),
      evidence('documented-boundary', 'The shared sensitive-content boundary matrix separates file, transcript, trace, memory, compaction, and model echo guarantees.', [SENSITIVE_BOUNDARY_MATRIX]),
      evidence('documented-boundary', 'The report allows local protection claims only.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Observability and Memory',
      entrypoint: 'Record traces or propose memory entries',
      boundary: 'Protection is local to these systems and does not cover the full chain.',
    },
    runtimeProof: {
      status: 'test-verified',
      summary: 'Local protections, transcript redaction policy, memory.propose fake-key rejection, code-review diff prompt redaction, compaction projection redaction, and the P1 integration smoke are test-supported, but this is not a full-chain runtime guarantee.',
      refs: ['tests/unit/observability-namespace.test.ts', 'tests/unit/memory-api.test.ts', 'tests/unit/sensitive-content-boundary.test.ts', 'tests/unit/role-orchestration-methods.test.ts', 'tests/unit/code-review-center.test.ts', 'tests/unit/compression-artifact.test.ts', 'tests/integration/p1-sensitive-content-boundary.integration.test.ts', SENSITIVE_BOUNDARY_MATRIX],
    },
    knownExclusions: [
      'No full-chain secret-free guarantee.',
      'No guarantee that raw files, raw Git diffs/copy-patch UI, raw transcripts with redaction disabled, provider payloads, or model echoes are redacted.',
    ],
    relatedTaskIds: ['P1-10', 'P1-11', 'P1-12', 'P1-13', 'P1-14'],
  }),
  entry({
    id: 'capability-41',
    reportItem: 41,
    title: 'Transcript, files, and model echoes are guaranteed plaintext-free',
    classification: 'FP-OVERCLAIM',
    claim: {
      safe: 'Some subsystems have sensitive-content protections, but file, transcript, trace, memory, compaction, and model echo boundaries differ.',
      unsafe: 'The full chain guarantees no sensitive plaintext appears anywhere.',
    },
    evidence: [
      evidence('documented-boundary', 'The shared matrix documents each sensitive-content surface and rejects a full-chain plaintext-free guarantee.', [SENSITIVE_BOUNDARY_MATRIX]),
      evidence('documented-boundary', 'The report marks full-chain plaintext-free language as an overclaim.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Security and privacy boundary',
      entrypoint: 'Use chat, files, transcripts, traces, memory, compaction, or model output',
      boundary: 'Each storage/projection surface has a separate guarantee level.',
    },
    runtimeProof: {
      status: 'not-guaranteed',
      summary: 'No full-chain guarantee exists for files, transcripts, compaction summaries, or model echoes.',
      refs: [MATRIX_REPORT, SENSITIVE_BOUNDARY_MATRIX],
    },
    knownExclusions: [
      'Raw file surfaces can contain sensitive content by design.',
      'Raw transcript surfaces are governed by local redaction policy and config, not a global plaintext-free guarantee.',
      'Compaction artifacts/projections have local fake-key redaction evidence, but provider-generated summaries and model echo surfaces are not globally guaranteed to redact every secret.',
    ],
    relatedTaskIds: ['P1-10', 'P1-11', 'P1-12', 'P1-14'],
  }),
  entry({
    id: 'capability-42',
    reportItem: 42,
    title: 'Low confidence automatically pauses and requests confirmation',
    classification: 'PARTIAL/FP-OVERCLAIM',
    claim: {
      safe: 'Memory, Task Loop, and orchestration have local confidence or review signals.',
      unsafe: 'Ordinary Chat has a global low-confidence pause-and-confirm state machine.',
    },
    evidence: [
      evidence('source', 'Task Loop and memory review source paths exist.', ['openclaw_runtime/src/agents/task-loop-controller.ts', 'openclaw_runtime/src/runtime-core/memory-store.ts']),
      evidence('documented-boundary', 'The report excludes a global ordinary Chat threshold state machine.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Memory review or Task Loop review',
      entrypoint: 'Use paths that emit review or evidence signals',
      boundary: 'Local review signals are not a global ordinary Chat pause behavior.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Local signals exist; global low-confidence pause is not proven.',
      refs: [MATRIX_REPORT],
    },
    knownExclusions: [
      'No global low-confidence pause threshold for ordinary Chat.',
      'No guarantee that all uncertain outputs request confirmation.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-43',
    reportItem: 43,
    title: 'Unified plan self-review and skeptic role',
    classification: 'PARTIAL',
    claim: {
      safe: 'Reviewer, security, skeptic roles and Task Loop self-check exist.',
      unsafe: 'Every ordinary Chat plan is forced through a unified self-review and adversarial-review pipeline.',
    },
    evidence: [
      evidence('source', 'Role registry and Task Loop self-check source paths exist.', ['openclaw_runtime/src/agents/role-registry.ts', 'openclaw_runtime/src/agents/task-loop-controller.ts']),
      evidence('unit-test', 'Task Loop tests cover self-check/evidence behavior.', ['tests/unit/task-loop-controller.test.ts']),
    ],
    userPath: {
      surface: 'Task Loop or role orchestration',
      entrypoint: 'Use explicit long-task or review-oriented role flows',
      boundary: 'Roles exist, but ordinary Chat is not forced through them.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Self-check and roles exist; universal enforcement is not proven.',
      refs: ['tests/unit/task-loop-controller.test.ts', MATRIX_REPORT],
    },
    knownExclusions: [
      'No universal ordinary Chat self-review enforcement.',
      'No guarantee that every plan includes a skeptic role.',
    ],
    relatedTaskIds: [],
  }),
  entry({
    id: 'capability-44',
    reportItem: 44,
    title: 'Failure automatically enters repair or blocked state',
    classification: 'PARTIAL',
    claim: {
      safe: 'Task Loop has repair and blocked paths; ordinary orchestration/team paths are weaker.',
      unsafe: 'Every failure in ordinary Chat or team orchestration automatically enters full repair/blocked handling.',
    },
    evidence: [
      evidence('unit-test', 'Task Loop repair and blocked paths have unit coverage.', ['tests/unit/task-loop-controller.test.ts']),
      evidence('documented-boundary', 'The report scopes repair/blocked claims to Task Loop.', [MATRIX_REPORT]),
    ],
    userPath: {
      surface: 'Task Loop',
      entrypoint: 'Run an explicit Task Loop that can repair or block',
      boundary: 'Do not apply Task Loop repair semantics to all ordinary Chat failures.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'Task Loop repair/blocked is supported; ordinary paths are not equivalent.',
      refs: ['tests/unit/task-loop-controller.test.ts', MATRIX_REPORT],
    },
    knownExclusions: [
      'No global automatic repair for every ordinary Chat failure.',
      'No guarantee that team_orchestrate failures become UI-visible repair nodes.',
    ],
    relatedTaskIds: ['P1-05', 'P1-09'],
  }),
  entry({
    id: 'capability-45',
    reportItem: 45,
    title: 'Explicit long-session coordinator keeps one durable piece of work across configured lifecycle actions',
    classification: 'TP-RUN + PARTIAL',
    claim: {
      safe: 'An explicitly bound coordinator session persists its Task Ledger references and physical generation across app/Gateway restart, exposes completion batches in the Chat activity rail, reads a bounded accepted-only ContinuityContextPack/v1 before a bound turn, reclaims owned terminals/browsers/managed ports on delete, and keeps scheduled follow-ups fenced to the bound generation.',
      unsafe: 'Every chat becomes a durable project manager that resumes provider-native threads across vendors, compresses context without loss, or survives publication/default changes.',
    },
    evidence: [
      evidence('real-runtime', 'Six built Electron/Host/Gateway restart journeys (bind, restart recovery, second-workspace isolation, handoff/fork/compact, revoke+archive+terminal reclaim, delete+late-event refusal) passed with 3 negatives and zero cross-scope leaks.', [
        'harness/specs/fixtures/long-session-development/f1/restart-journey-results.json',
        'harness/specs/fixtures/long-session-development/f1/host-runtime-receipts.json',
      ]),
      evidence('e2e', 'A 333-session / 57.16 MiB built Electron run kept load at 752 ms, switch P95 at 176.1 ms, long-session open at 137.3 ms with no long task over 50 ms, 60 flat idle-RSS samples and 50 owner-lifecycle rounds with zero scope residue.', [
        'harness/specs/fixtures/long-session-development/f2/long-use-before-after.json',
        'harness/specs/fixtures/long-session-development/f2/rss-and-owner-counts.json',
      ]),
      evidence('unit-test', 'Completion continuation delivers one meaningful prompt per batch, refuses a concurrent lease and issues no duplicate refresh on a replayed run.ended; hidden surfaces issue zero background polls.', [
        'harness/specs/fixtures/long-session-development/f2/notification-budget.json',
        'tests/unit/long-session-long-use-budget.test.ts',
      ]),
      evidence('documented-boundary', 'The product-semantics guardrail records the explicit-boundary, single-owner rules and the keep-baseline continuity decision.', [
        'docs/clawx-product-semantics.md',
        'harness/specs/fixtures/long-session-development/d3/continuity-strategy-decision.json',
      ]),
    ],
    userPath: {
      surface: 'Chat activity rail (explicitly bound coordinator session)',
      entrypoint: 'Bind a coordinator session, send work, restart, and follow the completion batch',
      boundary: 'Ordinary Chat is not auto-promoted; the C4 rail requires an explicit binding and the task facts stay in Task Ledger.',
    },
    runtimeProof: {
      status: 'partial',
      summary: 'The Windows x64 local loop is proven through real Electron/Host/Gateway journeys plus a long-use measurement; native-backend/provider continuity, macOS/Linux and the packaged build stay unmeasured.',
      refs: [
        'harness/specs/fixtures/long-session-development/f1/verification-receipt.json',
        'harness/specs/fixtures/long-session-development/f2/verification-receipt.json',
      ],
      lastVerifiedAt: '2026-10-24',
    },
    knownExclusions: [
      'No live-provider or native-backend thread continuity claim: no authorized provider credential was available.',
      'No asynchronous compression promotion: D2/D3 stayed EVIDENCE_INSUFFICIENT and keep-baseline.',
      'No macOS/Linux or packaged-build long-use measurement.',
      'No real-human long-term use: every artifact is agent-driven and the fixture is synthetic; nothing here is human-usage evidence.',
      'No universal resource cleanup: worktree ownership that cannot be resolved stays reported for review.',
      'No cross-session/global automatic project management or independent Project lifecycle.',
    ],
    relatedTaskIds: ['TF-0548', 'TF-0563'],
  }),
] satisfies CapabilityClaimMatrixEntry[];

export function findCapabilityClaim(id: string): CapabilityClaimMatrixEntry | undefined {
  return CAPABILITY_CLAIM_MATRIX.find((entry) => entry.id === id);
}
