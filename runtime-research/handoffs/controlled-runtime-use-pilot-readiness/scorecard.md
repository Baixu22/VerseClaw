# Quantitative Scorecard

Hard vetoes override every score. Scores are readiness scores for entering controlled pilot implementation slices, not approval for default-on behavior or runtime authority.

## AST Pilot

| Category | Max | Score | Evidence | Gap |
|---|---:|---:|---|---|
| Usable value | 25 | 22 | Readonly candidate generation can turn validated TS/TSX rules into ordered, bounded planning evidence. | No apply or TaskLoop integration is approved. |
| Current evidence strength | 20 | 19 | Accepted readonly scan synthesis, focused AST tests, and controlled readiness sentinel. | Live pilot corpus remains future evidence. |
| Boundary safety | 20 | 20 | No apply/write/mutation/export/transport authority; preview diff is not completion evidence. | None. |
| Verification quantifiability | 15 | 14 | 16 AST matrix cases, focused unit tests, harness validation, and boundary scans. | Real operator pilot metrics remain future. |
| Dependency maturity | 10 | 9 | Built on accepted runtime-core helper and existing tests. | Limited to TypeScript/TSX. |
| Rollback/reversibility | 10 | 10 | Omit flags and stop explicit helper calls; no persisted cleanup. | None. |
| Total | 100 | 94 | Ready for controlled readonly candidate-generation pilot if validation passes and vetoes stay clear. | Default-on/apply remains forbidden. |

## Registry Pilot

| Category | Max | Score | Evidence | Gap |
|---|---:|---:|---|---|
| Usable value | 25 | 23 | Controlled diagnostic consumer can surface provider/tool failure evidence without changing legacy behavior. | Diagnostics are not authority. |
| Current evidence strength | 20 | 19 | Accepted diagnostic collector synthesis, focused registry/MCP/TaskLoop tests, and controlled readiness sentinel. | Live consumer telemetry remains future evidence. |
| Boundary safety | 20 | 20 | No provider ordering, tool authority, TaskLoop authority, prompt/model-message, transport, persistence, or default-on behavior. | None. |
| Verification quantifiability | 15 | 14 | 16 registry matrix cases, focused unit tests, harness validation, and boundary scans. | Operator-facing aggregate metrics remain future. |
| Dependency maturity | 10 | 9 | Uses accepted collector, existing shadow gates, MCP diagnostics, and TaskLoop injected diagnostics. | Future direct collector-output seam is still optional follow-up. |
| Rollback/reversibility | 10 | 10 | Omit collector/shadow flags and drop injected diagnostics; no persisted cleanup. | None. |
| Total | 100 | 95 | Ready for controlled diagnostic consumer pilot if validation passes and vetoes stay clear. | Default cutover remains forbidden. |

## Parallel Pilot

| Category | Max | Score | Evidence | Gap |
|---|---:|---:|---|---|
| Usable value | 25 | 23 | AST planning evidence and registry diagnostics can advance independently while giving a fuller operator picture. | No shared authority or automated runtime action is approved. |
| Current evidence strength | 20 | 18 | Both predecessor syntheses are accepted and boundary sentinels cover both surfaces. | Joint pilot replay evidence remains future. |
| Boundary safety | 20 | 20 | Specs forbid cross-authorization, provider ordering drift, AST apply/write, TaskLoop/Gateway/provider transport drift, and default-on behavior. | None. |
| Verification quantifiability | 15 | 14 | 32 total samples, shared veto gates, focused tests, typecheck, comms replay/compare, and scans. | Production-like sample results remain future. |
| Dependency maturity | 10 | 9 | Both lines rely on accepted default-off surfaces and existing tests. | Parallel operator runbook can be added in a later slice. |
| Rollback/reversibility | 10 | 10 | Either line can be disabled independently by omitting its flags/explicit inputs. | None. |
| Total | 100 | 94 | Ready for parallel controlled pilots if validations pass and vetoes stay clear. | Parallel does not authorize coupling or default-on behavior. |
