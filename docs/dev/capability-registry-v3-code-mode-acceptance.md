# Capability Registry V3-06 Code Mode Acceptance

## Scope

This record covers an explicit opt-in Code Mode adapter over the existing Tool
Search sandbox. It does not create a new code runner, make Code Mode default-on,
or alter prompts, DCS, provider transport, Host API, UI, or persistence.

## Decision

V3-06 is accepted as an explicit opt-in runtime package. The existing Tool
Search Code Mode caller remains the default implementation. This acceptance
does not authorize a production caller, a prompt change, a new sandbox, or GA.
V3 remains default-disabled: no default caller, application setting, or
automatic activation was added.

## Acceptance Evidence

Acceptance run: 2026-08-14 on branch `codex/v3-capability-registry`, based on
`8306466d175016a938703c41125dc3a3dca68390`.

### Implementation Boundary

- `CapabilityCodeModeAdapter` reuses the single existing Tool Search Code Mode
  sandbox and bridge protocol.
- `search` and `describe` use V3 progressive disclosure; `call` verifies a
  session-bound trusted lease and reaches the target through the existing
  Tool Search executor, hooks, approval, schema, abort, and timeout owners.
- Successful calls return ArchiveHandle-backed Result Pointer metadata only.
  Bridge request ids are idempotent for one run and a lease is revoked after
  the call completes or fails.
- The Code Mode runner output boundary is closed and whole-value bound. The
  bridge registers the canonical JSON identity of every container it hands out
  (search navigation metadata, the describe L3 projection, call pointer
  metadata, and every nested container inside them). A runner final value is
  accepted only when it is a non-empty JSON-safe composition whose containers
  are those exact registered identities or new envelopes whose children are
  all accounted and which contain at least one registered container. Bare
  primitives may never appear outside a registered container, so a runner
  cannot rebuild an object from known strings (reusing a search category, a
  schema field, or a pointer id to fabricate a plain object fails closed).
  Primitives, plain unprovenanced objects, raw target results, raw/rawResult/
  rawTargetResult/content/details/credentials/tool+result shapes, cycles,
  non-JSON values, and injected runners that never call the bridge all fail
  closed as a controlled `code-mode-failed` error whose message never reflects
  raw inputs, target output, or underlying exception text. Whole-value
  canonical identity is the primary mechanism; the former blacklist-only
  shape check is retained only as a secondary defense.
- Disabled construction is inert and does not inspect the catalog, invoke the
  sandbox, or alter the legacy caller.

### Reproducible Gates

| Gate | Result | Evidence |
|---|---|---|
| `pnpm harness context --spec harness/specs/tasks/capability-registry-v3-code-mode.md` | PASS (exit 0) | Context resolved to the V3 task, scenario, rule, and layer guidance. |
| `pnpm harness validate --spec ... --no-diff` | PASS (exit 0) | `Spec is valid`. |
| Strict `pnpm harness validate --spec ...` | PASS WITH RESIDUAL (exit 0) | `RESIDUAL` lists only the three pre-existing Task Forest workspace files below; no V3 path is uncovered. `residualPaths` is exact-only: wildcards such as `**` fail validation with exit 1. |
| Harness unit tests (`tests/unit/harness-specs.test.ts`, `tests/unit/harness-git.test.ts`) | PASS | 2 files / 41 tests, including the residualPaths exact-only regression suite (wildcard, traversal, absolute, empty, and directory entries rejected; CLI exit 1 with an explicit error for `residualPaths: ["**"]`). |
| Focused V3 runtime lane | PASS | Capability lane: 11 files / 84 tests; agents lane: 2 files / 27 tests (including the closed runner boundary regressions and the known-string reuse regressions for search/describe/call); infra lane: 1 file / 2 tests; total: 14 files / 113 tests. |
| `pnpm --dir openclaw_runtime tsgo:core` | PASS (exit 0) | Runtime production typecheck. |
| `pnpm --dir openclaw_runtime tsgo:core:test` | PASS (exit 0) | Runtime test typecheck. |
| `pnpm run lint:check` | PASS (exit 0) | ESLint 0 errors, 127 pre-existing warnings; none in V3/harness files touched by this acceptance. |
| `pnpm run typecheck` | PASS (exit 0) | `success: true`; node and web projects exited 0. Test project runs in observation mode (exit 2, 1269 legacy errors) and does not fail the gate; none of its errors sit in lines touched by this acceptance. |
| `pnpm run comms:replay` / `pnpm run comms:compare` | PASS (exit 0) | All comms thresholds passed (0.00% deltas). |
| Task Forest validate | PASS (exit 0) | `校验通过` (validation passed). |
| `git diff --check` | PASS (exit 0) | No whitespace errors. |
| Global `pnpm run harness:ci` | FAIL (exit 1, recorded residual) | The `gateway-backend-communication` scenario spec does not own the V3 change set (`openclaw_runtime/**`, `docs/dev/capability-registry-v3-*`, `harness/specs/capability-registry-v3*`, Task Forest, `artifacts/system-maturity/**`). This is a workspace-ownership mismatch, not a V3 failure; per plan, Gateway scenario ownership was not expanded and the failure is recorded rather than hidden. |

### Workspace Residual

The three Task Forest files are workspace residuals (agent workbench exports),
not V3 functional failures:

- `.agent-workbench/task-forest/exports/task-forest.graph.json`
- `.agent-workbench/task-forest/exports/task-forest.html`
- `.agent-workbench/task-forest/graph/forest.json`

They are the only paths outside V3 ownership in the strict diff validation and
are declared per spec as exact residualPaths. Near-miss paths such as
`.agent-workbench/task-forest/other.json` remain uncovered and would fail the
strict gate.

## Decision Rationale

Legacy-parity, lease verification, Result Pointer boundaries, closed runner
output provenance, replay idempotency, abort/timeout forwarding, and static
gates are covered by the focused evidence above. V3-06 remains opt-in and is
not a production cutover.