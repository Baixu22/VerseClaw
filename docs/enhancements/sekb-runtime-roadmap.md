# SEKB Runtime Roadmap

This roadmap describes how to continue SEKB after the v0.2 runtime knowledge
baseline. It is paired with
`harness/specs/tasks/sekb-runtime-long-task-development.md`, which is the
goal-mode execution entrypoint.

## Current State

SEKB v0.2 is implemented as runtime-side advisory infrastructure. It records
structured trajectories, stores confirmed principles, builds a bounded L1
index, retrieves relevant principles with deterministic lexical fallback, and
can be installed into an AgentHarness-like runtime through explicit hooks.

The current branch intentionally does not add a desktop UI, default-on runtime
behavior, automatic retries, hidden correction, tool blocking, autonomous
principle writes, or an external vector database.

## Design Adjustments From The Original MVP Prompt

The original MVP prompt asked for a broad self-evolving knowledge base with
capture, store, retrieval, and semi-automatic distillation. The repo baseline
keeps that direction but narrows the first delivered slice:

- Runtime state uses OpenClaw SQLite and Kysely-generated types, not a new
  database service.
- Embeddings are nullable and optional; lexical retrieval is the reliable MVP
  path.
- Distillation is manual confirmation only. Suggestions and reports are
  advisory until a human confirms a principle.
- Runtime hook integration is explicit and default-off.
- Error advice is visible advisory context. It does not retry, pause, block,
  or silently rewrite a tool result.
- UI and host-api exposure are separate future stages because they require
  locale coverage, renderer/Main boundary work, and Electron E2E coverage.

## Option 1: Runtime Integration Closure

This is the recommended next long task.

Goal: prove SEKB against real runtime hook/event shapes while preserving the
default-off advisory contract.

Deliverables:

- Runtime integration test using real AgentHarness hook/event shapes or the
  closest stable owner seam.
- Minimal adapter changes if current hook assumptions differ from real runtime
  events.
- Documentation showing how a runtime owner installs SEKB and how to verify
  captured trajectories and injected advice.
- Focused SEKB tests, schema verification if needed, and harness validation.

Acceptance:

- SEKB remains no-op unless explicitly installed with `enabled: true`.
- Task start creates a trajectory and appends bounded visible advice.
- Tool calls/results are recorded as trajectory steps.
- Error results derive cached `error_signature` values and append visible
  historical advice.
- Agent end records success or failure; abort records partial.
- SEKB hook failures do not fail the agent run.

Closure seam:

- The closest stable runtime owner is OpenClaw's plugin hook
  registration/runner surface. `AgentHarness` is the runtime capability
  contract for `runAttempt`; lifecycle/tool events are owned by
  `plugins/hook-types.ts` and `plugins/hooks.ts`.
- `installSekbHarnessHooks` can be installed against plugin-style targets that
  expose `on(hookName, handler)`.
- The real OpenClaw event path is `before_agent_start` for visible task
  `appendContext`, `before_tool_call` for non-blocking call capture,
  `tool_result_persist` for visible tool-result advice, and `agent_end` for
  success/failure/aborted terminal state.
- A standalone `abort` hook is not present in the plugin runner; OpenClaw aborts
  surface as `agent_end` with `success: false` and no error. The adapter keeps
  `subscribe({ type: "abort" })` support only for custom targets that already
  expose such an event.

## Option 2: Operator Distillation Workflow

Goal: turn the read-only operator report into a practical manual distillation
workflow without adding autonomous writes.

Possible deliverables:

- Runtime CLI or host-service method that returns `buildSekbOperatorReport`.
- A manual confirm/reject command or API that calls existing
  `DistillationTool` methods.
- Tests proving confirm is the only write path and rejection reasons are
  persisted.

This option must still avoid renderer UI unless explicitly selected.

## Option 3: Knowledge Migration

Goal: migrate existing docs, skills, or workflow knowledge into L2 principles
with human confirmation.

Possible deliverables:

- Markdown-to-principle parser or assisted import draft generator.
- Dry-run report that shows candidate principles without writing them.
- Confirmation path that writes through `confirm_and_save` or a similarly
  explicit human action.

Acceptance requires traceability from imported principle to source document and
tests that no import writes active principles without confirmation.

## Option 4: Desktop Knowledge Experience

Goal: expose SEKB state and manual distillation in the desktop app.

This is a later stage because it touches renderer/Main boundaries and
user-visible UI. It requires:

- Host API and Electron Main service route before renderer consumption.
- No direct renderer IPC or Gateway HTTP/WebSocket calls.
- Full i18n coverage for `en`, `zh`, `ja`, and `ru`.
- Design-token-compliant UI.
- Electron E2E coverage for the operator workflow.
- README translation review.

## Option 5: Verifier And Curator Research

Goal: design Stage 2/3 quality loops for verification, scoring, demotion, and
archival.

This option must remain design-first until the user decides:

- Distillation trigger frequency.
- Whether the verifier uses an independent model or the same model with
  different parameters.
- Curator scoring cadence and weights.
- Whether any autonomous status transitions are allowed.

No autonomous curator behavior should be implemented without a new task spec
and explicit user approval.

## Standard Verification Matrix

Use these commands as the default proof set:

```powershell
# Repo root
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' harness validate --spec harness/specs/tasks/sekb-runtime-long-task-development.md

# openclaw_runtime
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/sekb.test.ts
node scripts/generate-kysely-types.mjs --verify
```

Run these only when communication paths change:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run comms:replay
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run comms:compare
```

Run Electron E2E only when a user-visible desktop workflow changes.

## Handoff Format For Goal Mode

Each goal-mode handoff should end with:

- Branch and diff summary.
- Implemented stages.
- Deferred stages with rationale.
- Commands run and results.
- Comms/E2E/README translation decision.
- Next recommended option.
