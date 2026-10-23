# TF-0502 capability catalog implementation

- Task: `TF-0502` — one capability catalog and model capability list
- Actor: `codex`
- Evidence driver: `agent`
- VerseGit scope: excluded
- Release boundary: no public release, GA, liveReady or productApproved claim

## Implemented contract

- One `CapabilityCatalogSnapshot/v1` is built from the existing Tool Search
  catalog. It is an adapter, not a second registry.
- Each catalog entry carries scope, permissions, executor reference,
  availability, schema hash, revision and execution topology.
- Duplicate capability ids fail closed; no second catalog entry is chosen.
- Discovery fails closed with a reason when no capability is callable or no
  result matches the query.
- The V3 bridge returns the same catalog snapshot digest used by discovery.
- `ModelCapabilityProfile/v1` can bind that catalog identity; the identity is
  included in the effective digest and validated on readback.
- No Capability Registry UI, route or flag is introduced.

## A/B outcome

The predeclared A/B protocol was frozen before execution, then run once against
`space-bunny` at `http://127.0.0.1:3065/v1/responses`.

- schema characters: control 542 -> treatment 261 (reduction 281)
- first-call success: control 1/40 (2.5%) -> treatment 8/40 (20%)
- paired first-call delta 95% CI: [-1, 1]
- decision: **fail**, reason `firstCallNonInferior`

Because the predeclared threshold was not met, **TF-0502 does not graduate**
and is not marked done. The implementation remains available only as the
non-graduated single catalog adapter; no default was flipped.

### v1 measurement defect (recorded post-run)

`run-ab.mts` computed `firstCallDeltaCi95` as
`quantile(observed per-fixture differences, .025/.975)` - the min/max range
of observed diffs (`[-1, 1]`), not a 95% confidence interval of the paired
mean. Recomputed from the frozen `ab-run-v1.json` (40 pairs): 1 control-only
win, 8 treatment-only wins, mean paired difference `+0.175`. The single
control-only win pins `lower = -1`, so the check fails whenever any one
fixture favors control, regardless of the aggregate. The v1 verdict therefore
records the behaviour of the implemented statistic, not a measured
non-inferiority failure. Details: `ab-v1-defect-note.md`.

## A/B v2 (frozen, not yet executed)

`ab-protocol-v2.json` was frozen before any v2 call. It fixes, before the run:

- paired design, n=40, two strata (20 tool-selection + 20 schema-expansion pairs)
- fixed seed `20261023`, 10000 paired bootstrap resamples, percentile method
- `firstCallNonInferiority`: paired 95% CI lower bound of the treatment-minus-control
  success rate >= -0.05
- `schemaTokenReduction`: **provider-reported input tokens**, mean reduction > 0 and
  CI lower bound > 0 (the v1 character proxy is retained only as a diagnostic)
- zero provider errors across all calls; insufficient or neutral evidence fails

`run-ab-v2.mts` implements that protocol and refuses to rerun once
`ab-run-v2.json` exists. It is type-checked (`tsc --noEmit --strict`, exit 0).

**Execution status: not executed.** The endpoint `http://127.0.0.1:3065/v1/responses`
returns `401 Unauthorized` because `TF0502_API_KEY` is not present in the agent
environment (verified: process, User and Machine scopes all unset). No v2 call has
been made, so there is no v2 verdict and TF-0502 stays non-graduated.

To execute (one run only):

```powershell
$env:TF0502_API_KEY = '<provided out-of-band>'; pnpm exec tsx 'tests/unit/fixtures/capability-registry-v3/acceptance/TF-0502/run-ab-v2.mts'
```

## Acceptance mapping

| Criterion | Status | Evidence |
|---|---|---|
| Tool call source matches catalog digest | pass | `raw-evidence.json#catalogIdentity`; adapter tests |
| Discovery fails closed with a reason | pass | `raw-evidence.json#failClosed`; adapter tests |
| No second registry UI/flag/route | pass | `raw-evidence.json#surfaceBoundary`; static audit |
| Default vs disabled/advanced self-description is accurate | pass | `raw-evidence.json#modelView`; profile tests |
| A/B first-call noninferiority + schema-token positive CI | **fail** (v1 verdict; defect documented in `ab-v1-defect-note.md`; v2 predeclared rerun required before any graduation) | `ab-run-v1.json`; `raw-evidence.json#ab` |

## Reproduction

```powershell
& '.\openclaw_runtime\node_modules\.bin\tsx.CMD' 'tests/unit/fixtures/capability-registry-v3/acceptance/TF-0502/run-verification.ps1'
```

## Unverified boundary

- The A/B schema measurement is a deterministic character proxy, not provider
  token accounting.
- The A/B result is agent-driven; it is not human evidence.
- Since the A/B gate failed, this node cannot claim graduation, default-on or
  product approval.
- The v1 non-inferiority check is defective (min/max pseudo-CI). v2 is frozen
  but has not been executed (missing provider credential), so the threshold is
  still unresolved.
