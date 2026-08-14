# Capability Registry V3-08 Controlled Rollout Acceptance

## Scope

This record covers the default-disabled, in-memory rollout controller, bounded
receipt projection, metric sink, and A/B report. It does not add application
configuration, persistence, provider transport, a telemetry exporter, Host API,
Electron, Renderer, or a user-visible setting.

## Decision

V3-08 is accepted as a default-disabled, caller-owned in-memory control plane.
It provides rollout decisions and bounded evidence only; it cannot execute a
capability, change product locks, or graduate V3 automatically. Static,
fixture, and replay evidence cannot authorize default-on or GA.

## Acceptance Evidence

Acceptance run: 2026-08-14 on branch `codex/v3-capability-registry`, based on
`8306466d175016a938703c41125dc3a3dca68390`.

### Implementation Boundary

- `off`, `shadow`, `opt-in`, `canary`, kill-switch, exact allowlist, and stable
  deterministic cohort behavior are implemented without an application flag or
  default caller.
- Null, non-object, and non-string/invalid request ids produce inactive
  `invalid-request` decisions with `observe: false` and `cohort: "none"`.
- Receipt collection is bounded, request-id idempotent, conflict-aware, and
  stores a closed metadata projection. Raw results, credentials, and request
  ids are absent from low-cardinality metric attributes. Malformed runtime
  inputs return `invalid-observation` rather than throwing.
- Reports include category/namespace/capability Recall@k, first-call success,
  schema retry, fallback, policy denial, token/cache metrics, catalog-epoch
  cache misses, pointer token savings, and per-topology success/latency.
- Only `live` evidence participates in rollout comparison. The report always
  emits `defaultOn: false`, `liveReady: false`, and `productApproved: false`;
  these locks are literal `false` types, so no report can produce true, and
  decision statuses are limited to insufficient-evidence/hold/reviewable with
  no automatic graduation path. No snake_case config keys exist.

### Reproducible Gates

| Gate | Result | Evidence |
|---|---|---|
| `pnpm harness context --spec harness/specs/tasks/capability-registry-v3-controlled-rollout.md` | PASS (exit 0) | Context resolved to the V3 rollout task, scenario, rule, and layer guidance. |
| `pnpm harness validate --spec ... --no-diff` | PASS (exit 0) | `Spec is valid`. |
| Strict `pnpm harness validate --spec ...` | PASS WITH RESIDUAL (exit 0) | `RESIDUAL` lists only the three pre-existing Task Forest workspace files below; no V3 path is uncovered. `residualPaths` is exact-only: wildcards such as `**` fail validation with exit 1. |
| Harness unit tests (`tests/unit/harness-specs.test.ts`, `tests/unit/harness-git.test.ts`) | PASS | 2 files / 41 tests, including the residualPaths exact-only regression suite. |
| Focused V3 runtime lane | PASS | Capability lane: 11 files / 84 tests; agents lane: 2 files / 27 tests; infra lane: 1 file / 2 tests; total: 14 files / 113 tests. |
| `pnpm --dir openclaw_runtime tsgo:core` | PASS (exit 0) | Runtime production typecheck. |
| `pnpm --dir openclaw_runtime tsgo:core:test` | PASS (exit 0) | Runtime test typecheck. |
| `pnpm run lint:check` | PASS (exit 0) | ESLint 0 errors, 127 pre-existing warnings; none in V3/harness files touched by this acceptance. |
| `pnpm run typecheck` | PASS (exit 0) | `success: true`; node and web projects exited 0. Test project runs in observation mode (exit 2, 1269 legacy errors) and does not fail the gate; none of its errors sit in lines touched by this acceptance. |
| Task Forest validate | PASS (exit 0) | `校验通过` (validation passed). |
| `git diff --check` | PASS (exit 0) | No whitespace errors. |
| Global `pnpm run harness:ci` | FAIL (exit 1, recorded residual) | The `gateway-backend-communication` scenario spec does not own the V3 change set. Workspace-ownership mismatch, not a V3 failure; Gateway scenario ownership was not expanded and the failure is recorded rather than hidden. |

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

Policy safety, deterministic cohorts, bounded receipts, metric sink isolation,
malformed-input handling, A/B gates, live-evidence filtering, and cumulative
V3 tests are covered. The product locks remain closed at the type level and no
user-visible UI, persistence, telemetry exporter, or automatic graduation path
was added.