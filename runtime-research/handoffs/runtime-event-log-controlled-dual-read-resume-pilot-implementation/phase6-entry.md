# Runtime Event Log Phase 6 Entry Contract

Status: ready_to_start_fresh_spec_after_phase5
Date: 2026-07-01

This entry contract is the handoff from Phase 5 controlled dual-read diagnostic helper implementation into the next fresh-spec phase. It is not an authority cutover and does not approve event-log resume authority.

## Recommended Phase 6 Name

Runtime Event Log Controlled Dual-Read Resume Pilot Evidence Review.

Recommended fresh task spec path:

- `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md`

## Phase 6 Objective

Evaluate bounded evidence from the Phase 5 helper before any event-log authority cutover readiness work is considered.

The Phase 6 evidence review should define:

- the exact controlled corpus report set accepted from `buildRuntimeEventLogControlledDualReadResumePilotReport`;
- whether any live diagnostic summaries are admitted, and if so their explicit bounded sanitized caller-provided contract;
- how helper decisions, veto gates, rollback proof, and boundary scans are aggregated;
- which conditions require more evidence before any authority-cutover readiness spec can be written;
- which validation commands and boundary scans prove the evidence review remains diagnostic-only.

## Required First Reads

1. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/README.md`
2. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/phase6-entry.md`
3. `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md`
4. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-proposal/README.md`
5. `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md`
6. `runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/README.md`
7. `runtime-research/agent-runtime-index.md` Workflow Checkpoint Engine section

## Phase 6 Allowed Scope

- Add a fresh evidence-review task spec and handoff package.
- Add proposal/review-only docs, matrices, or pure helper logic only if the fresh spec owns them.
- Consume only bounded sanitized Phase 5 helper reports and explicit caller-provided live diagnostic summaries.
- Preserve `legacyAuthoritative: true` and `eventLogAuthoritative: false`.
- Produce only diagnostic evidence-review decisions.

## Phase 6 Hard Blocks

- No event-log resume authority.
- No `runtime.resume.preferEventLog`.
- No `cutover_enabled` output.
- No `event_log_authoritative` output.
- No `default_on` or `default-on` output.
- No schema/table/index/migration.
- No DB/table/file creation, SQLite writes, or JSON/JSONL/TXT sidecar.
- No Gateway route, Electron IPC, renderer UI, host-api, api-client, shared contract, provider transport, TaskLoop status/decision, prompt/model-message, retry/approval/tool policy, service/listener/daemon/server.
- No tool execution, patch apply, workspace writes, message sends, or transport calls as replay behavior.
- No treating event-log diagnostics, replay comparison, retention summaries, verifier sampling, readiness output, or evidence-review output as completion proof.

## Phase 6 Decision Shape

The evidence review may recommend only:

- `blocked_before_evidence_review`
- `needs_more_dual_read_evidence`
- `ready_for_authority_cutover_readiness_spec`

The last state means only that a later fresh cutover-readiness spec may be written. It does not approve event-log authority, runtime cutover, default-on behavior, or any TaskLoop/Gateway/provider/UI/API change.

## Phase 6 Development Prompt

```text
Continue in C:\Users\27933\Desktop\clawx\ClawX from local persisted docs only.

First run git status. Read:
1. runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/README.md
2. runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/phase6-entry.md
3. harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md
4. runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-proposal/README.md
5. harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md
6. runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/README.md
7. runtime-research/agent-runtime-index.md Workflow Checkpoint Engine section

Goal:
Create the fresh Phase 6 task spec for Runtime Event Log Controlled Dual-Read Resume Pilot Evidence Review.

Priority:
P1 fresh evidence-review task spec first.
P2 controlled helper-report corpus contract second.
P3 optional live diagnostic summary contract third.
P4 veto/rollback/boundary aggregation and scans fourth.
P5 handoff/index update last.

Hard boundaries:
No current event-log authority, no runtime.resume.preferEventLog, no default-on behavior, no schema/table/index/migration, no DB/table/file creation, no sidecar, no Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport/TaskLoop/prompt/policy cutover, no side-effect replay, and no completion proof from diagnostics.

If rtk is unavailable, run commands directly and record it.
If unrelated failures appear, classify them and do not modify unrelated modules.
```
