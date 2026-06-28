# Line C Grounding Phase F Implementation Synthesis

Phase F defines controlled production opt-in for diagnostics-only runtime use.

## Decision

- Accepted surface: explicit/default-off, owner-approved, cohort-limited, bounded, non-authoritative controlled production opt-in diagnostics metadata.
- Rejected surface: default-on, runtime authority, prompt/model-message/provider-ordering authority, raw/untrusted retention, persistence, memory promotion/fact acceptance/episode write, UI without i18n/E2E, unvalidated transport changes, and mutation surfaces.
- The phrase "Line C may enter controlled production opt-in diagnostics-only runtime use" is allowed only for this controlled diagnostics-only boundary, not default-on and not runtime authority.

## Validation Results

- `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-controlled-production-opt-in.md` passed.
- Normal `validate` was blocked by unrelated pre-existing dirty/untracked worktree files outside this phase surface; `validate --no-diff` passed.
- Predecessor Phase E spec validated with `--no-diff`.
- Grounding seven-file unit suite passed: 7 files / 51 tests.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` passed.
- `git diff --check` passed for the modified runtime index; new untracked phase files have no trailing whitespace.
- README.md, README.zh-CN.md, and README.ja-JP.md were reviewed; no update is required because this phase is controlled opt-in spec/handoff documentation only and does not change user-visible behavior.
- Comms replay/compare were not run because this phase touched only task specs, handoff documentation, and the runtime index; no Main/Gateway/host-api/api-client/provider transport/gateway events/runtime send-receive/delivery/fallback path changed.

Status: accepted
