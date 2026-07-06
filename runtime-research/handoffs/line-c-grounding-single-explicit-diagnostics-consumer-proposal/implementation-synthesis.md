# Line C Grounding Single Explicit Diagnostics-only Consumer Proposal Synthesis

The single explicit diagnostics-only consumer proposal is complete as docs/proposal work.

## Decision

- Accepted as proposal/design readiness only.
- Existing allowed capability remains the runtime-core default-on diagnostics-only metadata helper.
- This package does not authorize consumer implementation.
- This package does not authorize broad formal runtime use.
- A later fresh task spec may request implementation of exactly one explicit diagnostics-only consumer if it proves all boundaries again before code changes.

## Proposed Consumer

- Consumer id: `line-c.grounding.singleExplicitDiagnosticsOnlyConsumer`.
- Shape: one runtime-core local pure diagnostics report helper in a later implementation spec.
- Invocation: explicit callsite only, explicit consumer id required.
- Input: accepted sanitized grounding diagnostics metadata summary only.
- Output: bounded metadata-only, summary-only, diagnostics-only, read-only, local, non-authoritative report data.
- Required markers: `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
- Rollback: `enabled: false` and `killSwitch: true` must return disabled/default-off parity.

## Boundary Verdict

The proposal can stay within the current allowed diagnostics-only boundary because it stops before implementation and describes only one explicit local runtime-core diagnostics consumer. It does not require prompt/model-message/provider/Gateway/TaskLoop/runtime-decision consumption, persistence, raw retention, untrusted refs, memory writes, mutation, UI/API, transport changes, or production rollout.

If any later implementation spec needs any of those boundaries, that later verdict must be `needs_revision`.

## Still Forbidden

- Broad formal runtime use.
- Runtime authority.
- Prompt/model-message/provider/Gateway/TaskLoop/runtime-decision integration.
- Provider ordering or provider selection influence.
- Completion/tool/security/approval/retry authority.
- Raw retention, untrusted refs, `includeRaw: true`, or `includeUntrusted: true`.
- Persistence/cache/service/listener/exporter/database/sidecar.
- Memory promotion, fact acceptance, episode write, memory store write, or fact store write.
- Patch apply, workspace edit, symbol mutation, UI/API/transport changes, production rollout, or hidden default-on expansion.

## Current Worktree Basis

- `git status --short --branch` showed the branch `knowledge-ux-polish` ahead 8 and behind 1, with substantial pre-existing tracked modifications and untracked specs/handoffs/tests before this task.
- `git diff --name-status` and `git diff --stat` showed pre-existing tracked changes in README, docs, agent-dev, host-api, workspace, package, tests, and `runtime-research/agent-runtime-index.md`.
- This package added only the new task spec and new Line C handoff files, plus the minimal index update.
- Existing dirty worktree state was not reverted or normalized.

## Validation Results

- `Get-Content -LiteralPath AGENTS.md` passed.
- `Get-Content -LiteralPath C:\Users\27933\.codex\RTK.md` passed; RTK says shell commands should use `rtk`.
- `rtk --version` failed because `rtk` is not available on the PowerShell PATH.
- `git status --short --branch` passed and showed unrelated dirty/untracked worktree state.
- `rg --files runtime-research harness/specs/tasks` passed and confirmed relevant specs/handoffs are present.
- Required handoff and synthesis files for the accepted default-on diagnostics-only implementation, formal runtime-use readiness, and explicit diagnostics consumer readiness were read from the current worktree.
- Existing relevant task specs were read from the current worktree.
- `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-proposal.md` passed and selected the gateway backend communication scenario, communication rules, harness guides, and harness layer.
- Selected harness context files were read after context selection.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-proposal.md` failed because unrelated dirty/untracked files outside this task's owned surface are present in the current worktree.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-proposal.md --no-diff` passed.
- Comms replay/compare were not run because this docs/proposal package did not touch Gateway events, runtime send/receive, delivery, fallback behavior, Main, host-api, api-client, renderer, provider transport, or runtime communication paths.

Status: accepted
