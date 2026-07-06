# Validation Plan

## Readiness Validation

For this docs-only readiness package:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-evidence-replay-governance-readiness.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-evidence-replay-governance-readiness.md
rg -n "runtime-failure-evidence-replay-governance-readiness|Failure Intelligence|Evidence Envelope|Replay Harness|Outcome Scorecard|Tool Invocation Governance" harness/specs/tasks runtime-research
```

## Future Schema Spike Tests

Minimum focused tests:

- `FailureEvent` accepts known stages/kinds/actions and rejects unknown unversioned values.
- `EvidenceEnvelope` fails closed on missing TTL, expired TTL, missing redaction, `rawRetained: true`, authority not `none`, missing provenance, scope mismatch, and oversized payload.
- `ReplayCase` rejects live-provider-only fixtures unless explicitly marked by a future spec.
- `TaskOutcomeScorecard` requires evidence references for every nontrivial metric.
- `ToolGovernanceDecision` separates advisory diagnostics from active blocking decisions.

## Initial Replay Corpus

First five cases:

| Case | Required proof |
|---|---|
| success | No false failure, no unnecessary edit, stable terminal status. |
| tool error | Correct `tool_call` stage, retry/backoff classification, no repeated blind retry. |
| test failure | Correct `test` stage, repair path captured, final status compares cleanly. |
| provider timeout | Correct `provider` stage, retry/degrade/ask-user decision is explainable. |
| dirty workspace | Workspace state is captured as fixture metadata; unrelated changes are not reverted. |

Second wave:

| Case | Required proof |
|---|---|
| blocked | Runtime stops with structured blocker and no fake completion. |
| long context | Context pressure is represented without prompt byte explosion. |
| flaky test | Retry is bounded and classified separately from deterministic failure. |
| user interruption | Terminal state is interruption, not failure or completion. |
| budget exhausted | Stop/ask-user action is selected without unsafe truncation. |

## Boundary Scans For Future Implementation

Run scans against touched files for:

```text
rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
rg -n "createServer\\(|listen\\(|WebSocketServer|daemon|listener|external database|sqlite|postgres|mysql|redis|express\\(" <touched-files>
rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|fs\\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <touched-files>
rg -n "provider transport|model message|Gateway request|system prompt|user prompt|reviewer prompt|completion gate|approval|retry|rollback|tool block" <touched-files>
rg -n "rawRetained:\\s*true|authority:\\s*['\\\"](runtime|tool|provider|gateway|checkpoint|lifecycle|approval|retry|rollback|completion|write|block)|raw provider|secret|api key|environment dump|process\\.env" <touched-files>
```

## Promotion Criteria

Schema spike can promote to implementation only when:

- validators fail closed
- no active runtime behavior changes
- tests cover malformed and missing metadata
- rollback is deletion/flag-disable only

Failure Intelligence can promote to passive consumer only when:

- classifications are stable across fixtures
- unknown classification has bounded fallback
- suggested actions are advisory unless a later spec accepts active use

Evidence Envelope can promote to prompt/evidence slot only when:

- scope, TTL, confidence, redaction, provenance, and budget checks pass
- rejected evidence has explainable reasons
- provider transport raw payloads remain unchanged

Replay Harness can promote to scorecard input only when:

- same case is deterministic across repeated runs
- fixtures isolate workspace mutations
- report diffs are meaningful and bounded

Governance can promote to active high-risk guard only when:

- replay proves reduced unsafe/repeated failure behavior
- scorecard does not show increased wrong blocked outcomes
- rollback disables the rule without migration
