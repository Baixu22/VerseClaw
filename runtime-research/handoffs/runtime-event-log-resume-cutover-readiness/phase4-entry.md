# Runtime Event Log Phase 4 Entry Contract

Status: ready_to_start_fresh_spec_after_phase3
Date: 2026-07-01

This entry contract is the handoff from phase 3 readiness research into the next fresh-spec phase. It is not phase 4 implementation and does not approve resume authority cutover.

## Recommended Phase 4 Name

Runtime Event Log Controlled Dual-Read Resume Pilot Proposal.

Recommended fresh task spec path:

- `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md`

## Phase 4 Objective

Convert the phase 3 proof plan into a concrete proposal for a future limited, explicit, dual-read resume pilot.

The phase 4 proposal should define:

- the exact live evidence source or controlled corpus source;
- how legacy `long_task_checkpoints` and persisted RuntimeTaskEvent event-log replay are compared;
- which veto gates block pilot implementation;
- which rollout and rollback drills are required;
- which validation commands and boundary scans prove the pilot proposal is still diagnostic-only.

The proposal must keep `long_task_checkpoints` authoritative. Event-log output may only be compared and diagnosed.

## Required First Reads

1. `runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/README.md`
2. `runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/phase4-entry.md`
3. `harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md`
4. `runtime-research/handoffs/runtime-event-log-readonly-operator-inspection-surface/README.md`
5. `runtime-research/handoffs/runtime-event-log-robustness-retention-evidence-mvp/README.md`
6. `harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md`
7. `runtime-research/agent-runtime-index.md` Workflow Checkpoint Engine section

## Phase 4 Allowed Scope

- Add a fresh task spec for the controlled dual-read pilot proposal.
- Add proposal-only docs, matrices, or pure diagnostic helpers if the fresh spec owns them.
- Use only sanitized bounded summaries from existing event-log inspection, persisted resume shadow, or controlled fixtures.
- Define a limited pilot implementation spec as a future output only.
- Preserve `legacyAuthoritative: true` and `eventLogAuthoritative: false`.

## Phase 4 Hard Blocks

- No event-log resume authority.
- No `runtime.resume.preferEventLog`.
- No `cutover_enabled` output.
- No default-on behavior.
- No new schema/table/index/migration.
- No DB/table/file creation, SQLite writes, or JSON/JSONL/TXT sidecar.
- No Gateway route, Electron IPC, renderer UI, host-api, api-client, shared contract, provider transport, TaskLoop status/decision, prompt/model-message, retry/approval/tool policy, service/listener/daemon/server.
- No tool execution, patch apply, workspace writes, message sends, or transport calls as replay behavior.
- No treating event-log diagnostics, replay comparison, retention summaries, verifier sampling, or readiness output as completion proof.

## Entry Gate Status From Phase 3

Passed in phase 3:

- predecessor specs validate with `--no-diff`;
- phase 3 spec validates with `--no-diff`;
- focused event-log/checkpoint/TaskLoop tests pass;
- `pnpm --dir openclaw_runtime db:kysely:check` passes;
- boundary scans were run and classified;
- no phase 3 code path adds Gateway/UI/host-api/api-client/provider/TaskLoop/default-on/schema/service/listener/sidecar cutover.

Known ambient blockers to address or reclassify before PR/release review:

- broad `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md` is blocked by unrelated dirty/untracked files outside phase 3 touched areas;
- `pnpm run typecheck` is blocked by unrelated `evidence-verifier-code-task-gate-shadow.ts` errors;
- `pnpm --dir openclaw_runtime lint:kysely` is blocked by unrelated memory raw SQLite guardrail violations.

## Phase 4 Acceptance Shape

The phase 4 proposal may recommend only:

- `blocked_before_pilot`
- `needs_more_live_evidence`
- `ready_for_controlled_dual_read_pilot_implementation_spec`

It must not recommend or output:

- `cutover_enabled`
- `event_log_authoritative`
- `default_on`
- `prefer_event_log`

## Phase 4 Development Prompt

```text
Continue in C:\Users\27933\Desktop\clawx\ClawX from local persisted docs only.

First run git status. Read:
1. runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/README.md
2. runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/phase4-entry.md
3. harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md
4. runtime-research/handoffs/runtime-event-log-readonly-operator-inspection-surface/README.md
5. runtime-research/handoffs/runtime-event-log-robustness-retention-evidence-mvp/README.md
6. harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md
7. runtime-research/agent-runtime-index.md Workflow Checkpoint Engine section

Goal:
Create the fresh Phase 4 task spec for Runtime Event Log Controlled Dual-Read Resume Pilot Proposal.

Priority:
P1 fresh task spec first.
P2 live evidence/corpus proposal second.
P3 veto, rollout, rollback, and boundary scans third.
P4 handoff/index update last.

Hard boundaries:
No current event-log authority, no runtime.resume.preferEventLog, no default-on behavior, no schema/table/index/migration, no DB/table/file creation, no sidecar, no Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport/TaskLoop/prompt/policy cutover, no side-effect replay, and no completion proof from diagnostics.

If rtk is unavailable, run commands directly and record it.
If unrelated failures appear, classify them and do not modify unrelated modules.
```
