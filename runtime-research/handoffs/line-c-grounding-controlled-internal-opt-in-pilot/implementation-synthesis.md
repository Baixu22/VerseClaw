# Line C Grounding Phase A Implementation Synthesis

Phase A defines a controlled internal opt-in diagnostics pilot only.

## Decision

- Accepted surface: internal explicit/default-off diagnostics metadata, readonly/local/bounded/summary-only/non-authoritative.
- Rejected surface: default-on, production default rollout, runtime authority, prompt/model-message/provider-ordering/runtime-decision use, persistence, memory promotion/fact acceptance/episode write, raw/untrusted retention, UI/settings, transport changes, patch/workspace/symbol mutation.
- Required markers remain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.

## Validation Results

- `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-pilot.md` passed.
- Normal `validate` was blocked by unrelated pre-existing dirty/untracked worktree files outside this phase surface; `validate --no-diff` passed.
- Predecessor `line-c-grounding-production-entry-readiness-plan.md` validated with `--no-diff`.
- Grounding seven-file unit suite passed: 7 files / 51 tests.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` passed.
- `git diff --check` passed for the modified runtime index; new untracked phase files have no trailing whitespace.
- README.md, README.zh-CN.md, and README.ja-JP.md were reviewed; no update is required because this phase is internal spec/handoff documentation only.
- Comms replay/compare were not run because this phase touched only task specs, handoff documentation, and the runtime index; no Main/Gateway/host-api/api-client/provider transport/gateway events/runtime send-receive/delivery/fallback path changed.

Status: accepted
