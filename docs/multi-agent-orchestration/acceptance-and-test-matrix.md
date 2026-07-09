# P0 Acceptance and Test Matrix

## 1. Required Commands
# Multi-Agent Orchestration Acceptance and Test Matrix

## 1. P0 Required Commands

Run before implementation when possible:

```powershell
pnpm harness context --spec harness/specs/tasks/role-first-p0-verification-loop.md
pnpm harness validate --spec harness/specs/tasks/role-first-p0-verification-loop.md --no-diff
git status --short
```

Use `--no-diff` only for preflight structural validation when the workspace already has unrelated changes. Before review, run full validation in an isolated worktree or with a P0-only diff.

Run during implementation as tasks land:

```powershell
pnpm exec vitest run tests/unit/orchestration-result-bundle.test.ts
pnpm exec vitest run tests/unit/orchestration-gates.test.ts
pnpm exec vitest run tests/unit/agent-steering-team-bundle.test.ts
pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts
pnpm exec vitest run tests/unit/orchestration-protocol-v3.test.ts
```

Run before review:

```powershell
pnpm harness validate --spec harness/specs/tasks/role-first-p0-verification-loop.md
pnpm exec vitest run tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-gates.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-protocol-v3.test.ts
pnpm run comms:replay
pnpm run comms:compare
```

If the implementation does not touch Gateway/tool return payloads or runtime communication paths, `comms:replay` and `comms:compare` may be reported as not required with justification. If `team_orchestrate`, gateway handlers, delivery, or renderer projection changes, they are required.

If full harness validation fails because unrelated dirty files are present, record the failing file list and rerun in a clean/isolated worktree before claiming P0 complete.

## 2. Acceptance Matrix

| Acceptance item | Primary test | Evidence required |
| --- | --- | --- |
| Bundle builder creates stable `OrchestrationResultBundle` | `tests/unit/orchestration-result-bundle.test.ts` | Snapshot or explicit field assertions |
| Spawn-phase bundle includes run id, task graph, outcomes, failures, trace refs | `tests/unit/role-orchestration-methods.test.ts` | Assert `resultBundle` fields on observed run/tool result |
| Completion-phase bundle groups workers and verifier by `orchestrationRunId` | `tests/unit/agent-steering-team-bundle.test.ts` | Assert one bundle per orchestration |
| Schema gate rejects missing ids | `tests/unit/orchestration-gates.test.ts` | `decision: fail`, reason code |
| Schema gate rejects successful worker without evidence | `tests/unit/orchestration-gates.test.ts` | `missing_evidence` reason |
| Permission denied event appears in bundle or trace | `tests/unit/role-orchestration-methods.test.ts` | failure/permission summary assertion |
| Memory candidates remain proposals | `tests/unit/agent-steering-team-bundle.test.ts` | proposal refs in bundle; no direct memory store write |
| Verifier pass is normalized | `tests/unit/orchestration-gates.test.ts` | `VerifierGate` returns `pass` |
| Verifier fail is normalized | `tests/unit/orchestration-gates.test.ts` | `VerifierGate` returns `fail` |
| Repair-required is bounded to one attempt | `tests/unit/orchestration-gates.test.ts` | second attempt returns final `fail` |
| Prompt bundle is rendered from structured bundle data | `tests/unit/agent-steering-team-bundle.test.ts` | rendered text contains gate/bundle fields |
| Existing role-first path does not regress | existing role-first tests | current tests green |
| P1-P4 remain absent | final report plus grep/diff review | no scheduler/importer/blackboard/synthesizer implementation |

## 3. Minimum Fixture Scenarios

Create or update tests to cover:

- all workers accepted and verifier not required,
- worker accepted with evidence and verifier pass,
- worker accepted but output/evidence missing,
- worker forbidden by permission/limit,
- verifier explicit fail,
- verifier repair-required with attempt 1,
- verifier repair-required with attempt 2 blocked,
- memory candidate emitted as proposal,
- follow-up candidate emitted without spawning follow-up work,
- malformed bundle rejected before verifier success path.

## 4. Review Checklist

Before marking P0 complete:

- `RoleContract` remains the runtime role authority.
- No prompt grants permissions.
- No worker writes long-term memory directly.
- No open A2A channel is added.
- No UI/i18n/E2E work is hidden in P0.
- All new runtime decisions are represented in typed data, not only prompt text.
- Every success/failure claim in the final report is backed by a command result.


## 5. P1 Required Commands

Run before implementation when possible:

```powershell
pnpm harness context --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
pnpm harness validate --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md --no-diff
git status --short
```

Run during implementation as tasks land:

```powershell
pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts
pnpm exec vitest run tests/unit/agency-role-importer.test.ts
pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts
pnpm exec vitest run tests/unit/orchestration-protocol-v3.test.ts
```

Run before review:

```powershell
pnpm harness validate --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts tests/unit/agency-role-importer.test.ts tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-gates.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-protocol-v3.test.ts
pnpm run comms:replay
pnpm run comms:compare
```

If P1 implementation does not touch Gateway/tool return payloads or runtime communication paths, `comms:replay` and `comms:compare` may be reported as not required with justification. If `team_orchestrate`, gateway handlers, delivery, or renderer projection changes, they are required.

## 6. P1 Acceptance Matrix

| Acceptance item | Primary test | Evidence required |
| --- | --- | --- |
| Scheduler produces deterministic waves | `tests/unit/orchestration-resource-scheduler.test.ts` | Same input produces equal `waves` and `metrics` |
| Scheduler respects dependencies | `tests/unit/orchestration-resource-scheduler.test.ts` | Dependent verifier/review nodes run after required workers |
| max active roles are runtime-enforced | `tests/unit/orchestration-resource-scheduler.test.ts` | wave sizes never exceed `concurrencyCap` |
| Tool contention splits conflicting roles | `tests/unit/orchestration-resource-scheduler.test.ts` | conflicting roles appear in different waves with reason text |
| Scheduler metrics are complete | `tests/unit/orchestration-resource-scheduler.test.ts` | queued/running/completed/skipped, concurrency cap, budget estimate, role cost summary |
| Orchestration run exposes scheduler metrics when enabled | `tests/unit/role-orchestration-methods.test.ts` | `schedulerMetrics` present without removing `resultBundle` |
| Agency importer emits draft-only entries | `tests/unit/agency-role-importer.test.ts` | entry `status: draft` by default |
| Agency draft entries cannot spawn | `tests/unit/agency-role-importer.test.ts` | `canSpawnAgencyDraft(entry)` is `false` |
| Draft promotion requires RoleContract validation | `tests/unit/agency-role-importer.test.ts` | invalid candidate returns validation issues |
| Tool hints do not grant runtime tools | `tests/unit/agency-role-importer.test.ts` | hints remain `toolHints`, not active `tools` unless candidate validates |
| Existing P0 verification loop does not regress | P0 unit suite | current P0 tests green |
| P2-P4 remain absent | final report plus grep/diff review | no ComplexityGate/RunbookTemplate/blackboard/synthesizer implementation |

## 7. P1 Minimum Fixture Scenarios

Create or update tests to cover:

- deterministic scheduling for identical graph input,
- three ready workers with max active roles of two,
- two roles contending for shell/write tools,
- verifier node delayed until worker nodes complete,
- scheduler metrics with skipped count zero for a valid graph,
- malformed graph or unschedulable cycle reported as skipped/failure data,
- Agency division with one agent and tool hints imported as draft,
- invalid Agency agent name normalized with validation issues,
- handoff text preserved as hints only,
- draft candidate validation pass and fail,
- draft entry not present in active role registry.

## 8. P1 Review Checklist

Before marking P1 complete:

- `RoleContract` remains the runtime role authority.
- Scheduler does not mutate role permissions or tools.
- max active roles enforcement is in runtime scheduling.
- Agency imported entries remain draft-only by default.
- No Agency markdown prompt becomes a runtime system prompt.
- No open A2A channel is added.
- No UI/i18n/E2E work is hidden in P1.
- Existing P0 gates and bundle behavior remain intact.
- Every success/failure claim in the final report is backed by a command result.

## 9. P2 Required Commands

Run before implementation when possible:

```powershell
pnpm harness context --spec harness/specs/tasks/role-first-p2-runbook-complexity-gate.md
pnpm harness validate --spec harness/specs/tasks/role-first-p2-runbook-complexity-gate.md --no-diff
git status --short
```

Run during implementation as tasks land:

```powershell
pnpm exec vitest run tests/unit/complexity-gate.test.ts
pnpm exec vitest run tests/unit/runbook-template.test.ts
pnpm exec vitest run tests/unit/runbook-task-graph.test.ts
pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts
```

Run before review:

```powershell
pnpm harness validate --spec harness/specs/tasks/role-first-p2-runbook-complexity-gate.md
pnpm exec vitest run tests/unit/complexity-gate.test.ts tests/unit/runbook-template.test.ts tests/unit/runbook-task-graph.test.ts
pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-gates.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-protocol-v3.test.ts
pnpm run comms:replay
pnpm run comms:compare
```

If P2 implementation does not touch Gateway/tool return payloads or runtime communication paths, `comms:replay` and `comms:compare` may be reported as not required with justification. If `team_orchestrate`, gateway handlers, delivery, or renderer projection changes, they are required.

## 10. P2 Acceptance Matrix

| Acceptance item | Primary test | Evidence required |
| --- | --- | --- |
| ComplexityGate classifies simple tasks as single-agent | `tests/unit/complexity-gate.test.ts` | Simple task fixture returns `single-agent` |
| ComplexityGate classifies high-risk or multi-file tasks as team/runbook candidates | `tests/unit/complexity-gate.test.ts` | Risk/file/capability table cases return expected modes |
| Explicit team selection is not blocked | `tests/unit/complexity-gate.test.ts` | Explicit team input returns team decision with warning/reason |
| RunbookTemplate validation rejects malformed templates | `tests/unit/runbook-template.test.ts` | Unknown roles, duplicate nodes, missing evidence, and bad deps fail |
| Runbook prose cannot grant permissions | `tests/unit/runbook-template.test.ts` | Unsafe `tools`, `permissions`, or prompt-like fields fail validation |
| Built-in runbook fixtures validate | `tests/unit/runbook-template.test.ts` | All fixture templates return `ok: true` |
| Runbook-to-task-graph uses existing RoleContract names only | `tests/unit/runbook-task-graph.test.ts` | Generated nodes reference known roles |
| Runbook-to-task-graph preserves scheduler/verifier boundaries | `tests/unit/runbook-task-graph.test.ts` | Generated graph schedules through P1 scheduler and has verifier boundary |
| Selection trace is structured | `tests/unit/runbook-task-graph.test.ts` or `tests/unit/role-orchestration-methods.test.ts` | selected/unselected reasons are data fields |
| Existing P0/P1 tests do not regress | P0/P1 unit suites | current P0/P1 tests green |
| P3-P4 remain absent | final report plus grep/diff review | no blackboard/synthesizer/UI/open-A2A implementation |

## 11. P2 Minimum Fixture Scenarios

Create or update tests to cover:

- short one-line task stays single-agent,
- explicit team request is honored,
- multi-file security task enters team orchestration,
- repeated test failure task selects test-repair runbook,
- explicit runbook id selects that runbook or returns an invalid selection reason,
- missing expected evidence fails runbook validation,
- duplicate graph node ids fail validation,
- unknown dependency fails validation,
- unsafe permission/tool fields fail validation,
- selected and unselected runbook reasons appear in structured trace/detail data.

## 12. P2 Review Checklist

Before marking P2 complete:

- `RoleContract` remains the runtime role authority.
- ComplexityGate does not grant permissions.
- RunbookTemplate is structured planning data, not prompt text.
- Runbook graphs still pass through P1 scheduler.
- P0 schema/verifier gates remain intact.
- No runbook prose grants tools, filesystem, network, commands, or memory writes.
- No typed blackboard or synthesizer is hidden in P2.
- No open A2A channel is added.
- Every success/failure claim in the final report is backed by a command result.

## 13. P3 Required Commands

Run before implementation when possible:

```powershell
pnpm harness context --spec harness/specs/tasks/role-first-p3-typed-blackboard.md
pnpm harness validate --spec harness/specs/tasks/role-first-p3-typed-blackboard.md --no-diff
git status --short
```

Run during implementation as tasks land:

```powershell
pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts
pnpm exec vitest run tests/unit/orchestration-blackboard-verifier.test.ts
pnpm exec vitest run tests/unit/orchestration-blackboard-trace.test.ts
pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts
```

Run before review:

```powershell
pnpm harness validate --spec harness/specs/tasks/role-first-p3-typed-blackboard.md
pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts tests/unit/orchestration-blackboard-verifier.test.ts tests/unit/orchestration-blackboard-trace.test.ts
pnpm exec vitest run tests/unit/complexity-gate.test.ts tests/unit/runbook-template.test.ts tests/unit/runbook-task-graph.test.ts tests/unit/orchestration-resource-scheduler.test.ts tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-gates.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-protocol-v3.test.ts
pnpm run comms:replay
pnpm run comms:compare
```

If P3 implementation does not touch Gateway/tool return payloads or runtime communication paths, `comms:replay` and `comms:compare` may be reported as not required with justification. If `team_orchestrate`, gateway handlers, delivery, or renderer projection changes, they are required.

## 14. P3 Acceptance Matrix

| Acceptance item | Primary test | Evidence required |
| --- | --- | --- |
| Blackboard entry validation covers supported types | `tests/unit/orchestration-blackboard.test.ts` | Fixtures for `fact`, `claim`, `question`, `risk`, `decision`, `artifact`, `conflict`, `handoff`, and `memory_proposal` |
| Validation rejects malformed entries | `tests/unit/orchestration-blackboard.test.ts` | Unknown roles, invalid confidence, missing required evidence, invalid visibility/status, unsafe permission fields, and direct memory writes fail |
| Append preserves stable metadata | `tests/unit/orchestration-blackboard.test.ts` | Version 1, timestamps, author role, task id, evidence refs, and trust boundary assertions |
| Versioned update preserves history | `tests/unit/orchestration-blackboard.test.ts` | Old and new versions remain reconstructable; immutable fields cannot be patched |
| Conflicting claims create conflict entries | `tests/unit/orchestration-blackboard.test.ts` | Conflict entry references both claim ids and originals remain present |
| Handoffs are structured data | `tests/unit/orchestration-blackboard.test.ts` | Handoff entry requires from/to role, summary, and evidence refs; text does not grant permissions |
| Untrusted content remains data | `tests/unit/orchestration-blackboard.test.ts` | Prompt-injection fixture is marked with trust-boundary metadata and no permission fields |
| Verifier can read blackboard evidence | `tests/unit/orchestration-blackboard-verifier.test.ts` | Read-only verifier projection includes evidence refs, confidence, trust boundary, and status |
| P0 gates remain authoritative | `tests/unit/orchestration-blackboard-verifier.test.ts` or `tests/unit/orchestration-gates.test.ts` | Blackboard evidence does not bypass schema/verifier pass/fail checks |
| Trace replay reconstructs blackboard history | `tests/unit/orchestration-blackboard-trace.test.ts` | Append/update/conflict events rebuild deterministic state |
| Existing P0/P1/P2 tests do not regress | P0/P1/P2 unit suites | current P0/P1/P2 tests green |
| P4/UI/open-chat/memory persistence remain absent | final report plus grep/diff review | no synthesizer/UI/open worker chat/new memory persistence implementation |

## 14. P4 Required Commands

Run before implementation when possible:

```powershell
corepack pnpm harness context --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md
corepack pnpm harness validate --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md --no-diff
git status --short
```

Run during implementation as tasks land:

```powershell
corepack pnpm exec vitest run tests/unit/orchestration-synthesizer.test.ts
corepack pnpm exec vitest run tests/unit/orchestration-dynamic-dag.test.ts
corepack pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts -t "synthesis"
```

Run before review:

```powershell
corepack pnpm harness validate --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md
corepack pnpm exec vitest run tests/unit/orchestration-synthesizer.test.ts tests/unit/orchestration-dynamic-dag.test.ts tests/unit/role-orchestration-methods.test.ts
corepack pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts tests/unit/orchestration-blackboard-verifier.test.ts tests/unit/orchestration-blackboard-trace.test.ts tests/unit/complexity-gate.test.ts tests/unit/runbook-template.test.ts tests/unit/runbook-task-graph.test.ts tests/unit/orchestration-resource-scheduler.test.ts tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-gates.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-protocol-v3.test.ts
corepack pnpm run test:e2e tests/e2e/role-orchestration-synthesis.spec.ts
corepack pnpm run comms:replay
corepack pnpm run comms:compare
```

P4 touches existing Gateway result payloads and visible UI projection, so comms replay/compare and Electron E2E are required.

## 15. P4 Acceptance Matrix

| Acceptance item | Primary test | Evidence required |
| --- | --- | --- |
| Synthesizer returns stable output | `tests/unit/orchestration-synthesizer.test.ts` | Same input produces equal synthesis |
| Synthesizer preserves role contributions and evidence | `tests/unit/orchestration-synthesizer.test.ts` | Role rows include status, evidence refs, and output previews |
| Verifier failures remain visible | `tests/unit/orchestration-synthesizer.test.ts` | `status: failed` and visible failure reasons are present |
| Synthesizer has no tool access | `tests/unit/orchestration-synthesizer.test.ts` | `policy.toolAccess` is `none` |
| Blackboard summary remains summary data | `tests/unit/orchestration-synthesizer.test.ts` | Conflict/question/risk/proposal counts are copied, no memory write occurs |
| Dynamic DAG rejects unauthorized roles | `tests/unit/orchestration-dynamic-dag.test.ts` | Unknown role proposal returns issue and graph is unchanged |
| Dynamic DAG rejects unsafe fields | `tests/unit/orchestration-dynamic-dag.test.ts` | `tools`, `permissions`, `prompt`, or `memoryWrite` are rejected |
| Dynamic DAG rejects unknown dependencies | `tests/unit/orchestration-dynamic-dag.test.ts` | Unknown dependency returns issue and graph is unchanged |
| Dynamic DAG rejects out-of-scope capabilities | `tests/unit/orchestration-dynamic-dag.test.ts` | Capability not present on source/authorized list is rejected |
| Dynamic DAG records source/reason/scope/attempt | `tests/unit/orchestration-dynamic-dag.test.ts` | Refinement metadata includes all four fields |
| Dynamic DAG preserves scheduler limits | `tests/unit/orchestration-dynamic-dag.test.ts` | Scheduled waves do not exceed max active roles |
| Gateway returns synthesis | `tests/unit/role-orchestration-methods.test.ts` | `orchestrator.run` payload includes `synthesis` while existing metadata remains |
| Team tool returns synthesis | `tests/unit/role-orchestration-methods.test.ts` | `team_orchestrate` details include `synthesis` |
| UI displays synthesis details | `tests/e2e/role-orchestration-synthesis.spec.ts` | Result view shows summary, verifier decision, evidence count, trace count, and visible failure |
| P0-P3 do not regress | P0/P1/P2/P3 unit suites | current regression suites green |

## 16. P4 Review Checklist

Before marking P4 complete:

- Synthesizer remains a pure projection and has no tool access.
- Verifier fail/repair decisions are never converted into success.
- Dynamic DAG can only add local scoped nodes and cannot mutate existing graph nodes.
- Dynamic DAG cannot grant tools or permissions.
- Dynamic DAG scheduling goes through P1 resource scheduler.
- Renderer uses `hostApi.gateway.rpc` only.
- UI exposes failures, verifier decisions, evidence refs, and trace refs.
- Locale coverage exists for en, zh, ja, and ru.
- Every success/failure claim in the final report is backed by a command result.

## 15. P3 Minimum Fixture Scenarios

Create or update tests to cover:

- valid entry fixtures for every supported entry type,
- unknown role rejected,
- invalid confidence rejected,
- missing evidence rejected for evidence-required types,
- unsafe `tools`, `permissions`, `prompt`, or `memoryWrite` content rejected,
- append creates version 1 and preserves trust boundary,
- update creates a new version and preserves prior history,
- two incompatible claims on the same subject create a conflict entry,
- unresolved conflict remains visible to verifier projection,
- prompt-injection-like text is stored as untrusted data,
- handoff entry stays structured and does not become direct worker chat,
- trace replay reconstructs append, update, and conflict events.

## 16. P3 Review Checklist

Before marking P3 complete:

- `RoleContract` remains the runtime role authority.
- Blackboard does not grant permissions.
- Blackboard is structured orchestration data, not direct chat.
- P1 scheduler still enforces max active roles and tool contention.
- P2 runbook graph boundaries remain intact.
- P0 schema/verifier gates remain intact.
- Conflicts are preserved rather than silently overwritten.
- Untrusted content is not interpreted as system, developer, role, or tool instructions.
- Blackboard entries do not automatically become long-term memory.
- Workers do not directly write long-term memory.
- No synthesizer or Role Catalog UI is hidden in P3.
- No open A2A channel is added.
- Every success/failure claim in the final report is backed by a command result.
