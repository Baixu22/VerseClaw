# P0 Acceptance and Test Matrix

## 1. Required Commands

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
