# Line C Grounding Phase C Implementation Synthesis

Phase C defines limited production opt-in while remaining diagnostics-only.

## Decision

- Accepted surface: explicit owner-approved production cohort diagnostics metadata with sampling, budget, privacy, and rollback controls.
- Rejected surface: default-on, prompt/model-message/provider-ordering/runtime-decision influence, raw/untrusted retention, persistence, memory writes, UI cutover without i18n/E2E, and mutation surfaces.

## Validation Results

- `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-limited-production-opt-in-diagnostics-only.md` passed.
- Normal `validate` was blocked by unrelated pre-existing dirty/untracked worktree files outside this phase surface; `validate --no-diff` passed.
- Predecessor Phase B spec validated with `--no-diff`.
- Grounding seven-file unit suite passed: 7 files / 51 tests.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` passed.
- `git diff --check` passed for the modified runtime index; new untracked phase files have no trailing whitespace.
- README.md, README.zh-CN.md, and README.ja-JP.md were reviewed; no update is required because this phase is internal diagnostics-only spec/handoff documentation and does not change user-visible behavior.
- Comms replay/compare were not run because this phase touched only task specs, handoff documentation, and the runtime index; no Main/Gateway/host-api/api-client/provider transport/gateway events/runtime send-receive/delivery/fallback path changed.

Status: accepted
