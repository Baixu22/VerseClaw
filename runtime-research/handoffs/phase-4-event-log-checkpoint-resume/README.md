# Phase 4 Handoff: Event Log, Checkpoint, Resume

Phase 4 starts after Phase 3 accepted the provider/tool registry pilot as default-off and shadow-only. The goal is to pilot append-only runtime event history, deterministic replay/reducer logic, checkpoint serialization, and resume comparison while keeping the existing TaskLoop, long-task checkpoint store, task ledger, and legacy resume behavior authoritative.

## Phase Goal

Build the smallest feature-flagged pilot for:

- append-only `RuntimeTaskEvent` event log envelopes and optional persisted shadow store;
- event search/filter/export primitives inspired by OpenHands event service semantics;
- state reducer and replay fixtures inspired by Temporal replay semantics;
- checkpoint serializer that preserves open obligations, evidence refs, file hashes, and schema markers;
- resume shadow that compares event-log-derived state against legacy checkpoint/session state;
- idempotency protection so completed side-effect tool results are reused, never re-executed;
- flag-off parity for TaskLoop lifecycle, checkpoints, mission-loop behavior, and tool calls.

## Non-Negotiable Constraints

1. Do **not** start a second runtime service, Temporal service, daemon, listener, port, WebSocket server, local HTTP server, or Gateway instance.
2. `verseshell-runtime` remains the user-configured stdio terminal tool exception, not event-log/checkpoint/resume authority.
3. Runtime event-log/checkpoint/reducer code must live under `openclaw_runtime/**` or an explicitly existing Main adapter boundary; renderer must not own transport, replay, or resume policy.
4. No new renderer direct `window.electron.ipcRenderer.invoke(...)` calls.
5. No renderer direct Gateway HTTP/WebSocket calls to `127.0.0.1:18789` / `localhost:18789`.
6. No default-on event-log or resume cutover until flag-off parity, shadow replay, idempotency, and rollback tests pass.
7. Resume/replay must not execute mutating tools, send messages, write files, call Gateway, or apply patches; reuse stored `ToolCallResult` / evidence by idempotency key.
8. Append-only history must not be rewritten or deleted except through an explicit compaction / continue-as-new event with schema/version marker.
9. Existing legacy behavior must remain authoritative unless a lane explicitly records a feature flag, rollback, and tests.
10. Any UI-visible resume/checkpoint change must include/run targeted Electron E2E.

## Required Reading

Every implementation window must read:

- `runtime-research/agent-runtime-index.md`
- `runtime-research/migration-execution-plan.md`
- `runtime-research/implementation-roadmap.md`
- `runtime-research/agent-runtime-core-spec.md`
- `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/synthesis.md`
- `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/synthesis.md`
- `runtime-research/temporal/workflow-semantics.md`
- `runtime-research/temporal/useful-tests.md`
- `runtime-research/openhands/runtime-events.md`
- `runtime-research/openhands/useful-tests.md`
- `runtime-research/handoffs/phase-4-event-log-checkpoint-resume/parallel-lanes.md`
- `runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submission-template.md`
- `harness/specs/tasks/phase-4-event-log-checkpoint-resume.md`

Then run:

```powershell
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md
```

If that command is unavailable in the shell, record the failure and use:

```powershell
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff
```

## Output Rules

Each lane writes exactly one submission:

```text
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/<lane-id>.md
```

Lane owners may edit only their declared implementation/test paths and their own submission file. Cross-lane conflicts are recorded in `Design Conflicts` / `Handoff Notes`; the synthesis owner reconciles them.

## Expected Lanes

- `lane-a-event-log-contracts-and-store`
- `lane-b-taskloop-event-log-dual-write`
- `lane-c-state-reducer-checkpoint-serializer`
- `lane-d-resume-shadow-idempotency`
- `lane-e-harness-tests-boundary-docs`

## Final Integration

The synthesis owner writes:

```text
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/synthesis.md
```

The synthesis must classify every lane as `accepted`, `needs_revision`, or `blocked`, and must not treat under-evidenced implementation claims as accepted facts.

