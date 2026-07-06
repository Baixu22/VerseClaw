# Line C Grounding Formal Runtime-use Readiness Synthesis

Formal runtime-use boundary readiness was evaluated against the current worktree and accepted Line C default-on diagnostics-only metadata implementation.

## Decision

- Allowed surface remains only the runtime-core diagnostics-only metadata helper default-on behavior for valid sanitized refs.
- Required output markers remain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
- Rollback remains `enabled: false` and `killSwitch: true`.
- No formal runtime integration is approved by this task.
- Broader formal use cannot proceed because any practical prompt/model-message/provider/Gateway/TaskLoop/runtime-decision consumer would cross a forbidden boundary.

## Current Worktree Basis

- `git status --short` showed existing unrelated dirty/untracked agent-dev work before this task.
- `git diff --stat` and `git diff --name-status` showed dirty tracked files only in agent-dev/package paths before this task; no grounding runtime-core file was dirty.
- Current grounding runtime-core files show the accepted helper remains local diagnostics metadata with fail-closed disable/kill-switch paths.
- Current tests assert no provider ordering/selection, model message, prompt, Gateway request, runtime decision, raw, or authority sentinel survives.

## Boundary Assessment

Allowed:

- Diagnostics-only metadata helper default-on in runtime-core.
- Local bounded summary metadata only.
- `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
- `enabled: false` and `killSwitch: true` rollback.

Pending evaluation:

- A single explicit future diagnostics-only consumer that stays non-authoritative and proves zero prompt/model-message/provider/Gateway/TaskLoop/runtime-decision drift.

Still forbidden:

- Runtime authority, prompt/model-message injection, provider ordering/selection, Gateway request insertion, runtime decisions, TaskLoop authority, completion/tool/security/approval/retry authority, raw retention, untrusted refs, persistence/cache/service/listener/exporter/database/sidecar, memory promotion, fact acceptance, episode write, patch apply, workspace edit, and symbol mutation.

## Validation Results

- `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-formal-runtime-use-readiness.md` passed and selected the gateway backend communication scenario, required communication rules, harness guides, and harness layer.
- Required context files were read after context selection: `harness/specs/scenarios/gateway-backend-communication.md`, required rules, applicable guides, and `harness/specs/layers/harness.md`.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-formal-runtime-use-readiness.md` failed because the current worktree contains unrelated dirty/untracked files outside this task's owned surface.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-formal-runtime-use-readiness.md --no-diff` passed.
- `git diff --check -- harness/specs/tasks/line-c-grounding-formal-runtime-use-readiness.md runtime-research/handoffs/line-c-grounding-formal-runtime-use-readiness/README.md runtime-research/handoffs/line-c-grounding-formal-runtime-use-readiness/implementation-synthesis.md runtime-research/agent-runtime-index.md` passed, with only the existing line-ending warning for `runtime-research/agent-runtime-index.md`.
- Boundary scan over the new spec, new handoff, synthesis, and runtime index found only expected boundary declarations and no implementation path for formal runtime authority, prompt/model-message/provider/Gateway/TaskLoop/runtime-decision consumption, persistence/cache/service/listener/exporter, memory writes, raw/untrusted retention, patch apply, workspace edit, or symbol mutation.
- Comms replay/compare were not run because this task changed only harness/runtime-research documentation and did not touch Gateway events, runtime send/receive, delivery, fallback behavior, Main, host-api, api-client, renderer, or provider transport.

## Command Notes

- `rtk` was requested by the local RTK note but was not available on this PowerShell PATH (`rtk` was not recognized), so validation used the explicit `node harness/src/cli.mjs ...` commands requested by the task.
- `runtime-research/agent-runtime-index.md` is not valid UTF-8, so `apply_patch` could not edit it. The index update used a byte-preserving PowerShell ASCII replacement to avoid re-encoding unrelated content.

Status: needs_revision
