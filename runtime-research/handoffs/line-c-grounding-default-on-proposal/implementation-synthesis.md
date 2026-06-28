# Line C Grounding Phase G Implementation Synthesis

Phase G defines a default-on proposal only.

## Decision

- Accepted surface: proposal-only default-on readiness criteria and future implementation plan requirements.
- Rejected surface: default-on implementation, default behavior change, runtime authority, prompt/model-message/provider-ordering authority, persistence, memory writes, UI default changes, transport changes, raw/untrusted retention, and mutation surfaces.
- Required output markers remain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
- Any default-on implementation requires a later accepted implementation spec.

## Validation Results

- `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-default-on-proposal.md` passed.
- Normal `validate` was blocked by unrelated pre-existing dirty/untracked worktree files outside this phase surface; `validate --no-diff` passed.
- Predecessor Phase F spec validated with `--no-diff`.
- Grounding seven-file unit suite passed: 7 files / 51 tests.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` passed.
- `git diff --check` passed for the modified runtime index; new untracked phase files have no trailing whitespace.
- README.md, README.zh-CN.md, and README.ja-JP.md were reviewed; no update is required because this phase is proposal-only spec/handoff documentation and does not change user-visible behavior.
- Comms replay/compare were not run because this phase touched only task specs, handoff documentation, and the runtime index; no Main/Gateway/host-api/api-client/provider transport/gateway events/runtime send-receive/delivery/fallback path changed.

Status: accepted
