# TF-0492 acceptance evidence

- Task: `TF-0492` — ModelCapabilityProfile/v1 and model capability positioning.
- Actor: `codex`
- Evidence driver: `agent`
- Product defaults changed: no
- VerseGit scope: excluded
- Runtime wiring: deferred to TF-0512

## Deliverable

`shared/model-capability-profile.ts` defines a pure, fixture-driven `ModelCapabilityProfile/v1` generator with:

- static disposition from the existing `ComponentDispositionManifest/v1`;
- independent runtime availability, action authorization, memory, and knowledge axes;
- workspace/role/session scope, tool identity, driver, grant, ack, quarantine, and knowledge version fields;
- canonical static and effective digests;
- a bounded prompt addition charged to the reserved system prompt, with zero working-context characters used.

## Acceptance mapping

| Criterion | Evidence |
|---|---|
| profile schema and pure generator have negative tests | `tests/unit/model-capability-profile.test.ts`; `raw-evidence.json#negativeCases` |
| every user-visible capability has exactly one static disposition and axes remain separate | `profile.json`; `raw-evidence.json#measurements` |
| static digest changes only with static configuration; effective inputs are fixture-backed and normalized | `state-cases.json`; `raw-evidence.json#digestNormalization` |
| fixture covers enabled/disabled/partial/degraded/quarantined/requires-approval/internal/retired | `raw-evidence.json#stateCoverage` |
| prompt addition has an explicit character budget and does not consume working context | `profile.json#promptAddition`; `raw-evidence.json#measurements.prompt` |

## Reproduction

```powershell
& '.\openclaw_runtime\node_modules\.bin\tsx.CMD' 'tests/unit/fixtures/model-capability-profile/acceptance/TF-0492/generate-acceptance.mts'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'tests/unit/fixtures/model-capability-profile/acceptance/TF-0492/run-verification.ps1'
```

`generate-acceptance.mts` rebuilds `profile.json`, `raw-evidence.json`,
`component-graduation-report.json`, and `SHA256SUMS` from repository sources and
the state fixture. `run-verification.ps1` records the exact exit code and output
hash for focused/adjacent tests, full typecheck, lint, catalog, contract, no-BOM,
diff, graduation-report, and SHA256 gates in `verification.json`.


Additional readback files: `acceptance-check.json` maps the five Task Forest criteria to disk evidence; `10-task-forest-validate-preapply.txt` records the pre-apply Task Forest validation exit code; `verification.json` records all formal gate exit codes and output hashes.

## Verified boundary

This evidence proves the pure contract, normalization, state coverage, static
product disposition coverage, and prompt budget. It does not prove that a live
driver, permission grant, memory backend, knowledge index, quarantine transition,
or restart propagation is wired into a runtime model call. That is explicitly the
scope of `TF-0512`.