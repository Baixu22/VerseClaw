# TF-0494 acceptance evidence

- Task: `TF-0494` — Workspace Context default graduation
- Actor: `codex`
- Evidence driver: `agent`
- VerseGit scope: excluded
- Release boundary: public release, GA, liveReady and productApproved remain unclaimed

## Delivered contract

- One user-level Workspace Context profile in Settings > General composes the working-memory recent-action window and the compact tool-registry summary.
- The profile defaults on, while `DcsProdFlagsPanel` remains developer diagnostics rather than a normal-user control surface.
- Same authority identity + revision + target is projected at most once per model call; different targets are not conflated.
- Candidate projection charges one shared turn ledger. Missing turnId falls back to the explicit 2,000-character budget.
- The provider-boundary precheck takes the larger preassembly transcript pressure before deciding overflow/compaction.
- Turning the profile off or engaging the context-enhancement kill switch restores the pre-enhancement baseline and reports an honest model summary.

## Acceptance mapping

| Criterion | Evidence |
|---|---|
| duplicate candidate identity/revision/target projection | `raw-evidence.json#duplicateProjection`; runtime context-candidate and assembler suites |
| tool-loop result enters later request, unchanged candidates dedup, retry/fallback retains constraints | runtime context suites plus `raw-evidence.json#toolLoop` and `#retryBoundary` |
| predeclared paired A/B with sample size, strata, metrics, noninferiority, stopping rule and CI | `canary-protocol.json`; `canary-run-v2.json`; `canary-run-v1-fail.json`; `raw-evidence.json#canary` |
| full request budget + 6,000-character enhancement budget; constraint retention, missing turnId, channel starvation and overflow rejection | `raw-evidence.json#budget`; runtime assembler, candidate, turn-budget and preassembly tests |
| off/kill baseline and accurate model effective state | `raw-evidence.json#rollback` and `#effectiveState`; Settings E2E plus runtime kill-switch suites |

## Canary amendment

v1 ran after the v1 protocol was written and failed: 10/80 outputs were empty or truncated and the baseline never elicited repeat tool calls. It is retained byte-for-byte as `canary-run-v1-fail.json`. v2 was then declared as `WorkspaceContextCanaryProtocol/v2` before its formal run, changing only elicitation (native function tools/function_call, 500 output-token ceiling) while retaining n=40, four strata, metrics, thresholds, noninferiority margin, bootstrap CI method and stopping rule. v2 passed. Neither result is retroactively relabeled.

## Reproduction

```powershell
$env:TF0494_API_KEY = '<provided locally; never written to the repository>'
& '.\openclaw_runtime\node_modules\.bin\tsx.CMD' 'tests/unit/fixtures/workspace-context/acceptance/TF-0494/generate-acceptance.mts'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'tests/unit/fixtures/workspace-context/acceptance/TF-0494/run-verification.ps1'
```

## Unverified boundary

- The canary measures an external Responses-compatible endpoint/model (`space-bunny`) and is agent-driven, not real-human evidence.
- The repository evidence does not claim that the endpoint's provider billing or cache accounting was independently audited.
- Public release, GA, liveReady and productApproved are not authorized by this pack.
