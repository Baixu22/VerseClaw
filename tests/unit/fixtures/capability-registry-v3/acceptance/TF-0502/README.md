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

## A/B v2.1 (executed once, deciding run)

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

An aborted first attempt (3 fixtures, no artifact written) exposed a matcher defect: the
runner compared the model answer (canonical id `openclaw:workspace-read`) against the
display name (`workspace_read`) and scored correct answers as failures. The protocol was
amended to v2.1 **before any completed run** (`amendments[0]` in `ab-protocol-v2.json`):
identity matches by display name or catalog id, `tool_describe` usage is a diagnostic
rather than a requirement, and no threshold changed.

**Execution status: executed once (v2.1).** `ab-run-v2.json` exists; the runner refuses
to rerun.

### v2.1 result

| quantity | value |
|---|---|
| calls | 80 (0 provider errors) |
| first-call success | control 4/40 (10.0%) vs treatment 12/40 (30.0%) |
| paired success delta 95% CI | [0.075, 0.325] (lower bound >= -0.05 required) |
| provider input tokens | control 12497 vs treatment 10617 |
| per-pair token reduction | 47 (CI [47, 47]; mean > 0 and CI lower > 0 required) |
| decision | **pass** |

Both thresholds are met without changing any threshold value.

### Residual measurement limitation (recorded, not repaired)

The matcher only recognises an explicit `{"tool": ...}` selection. In 40 pairs the
model instead answered in invocation form (`{"id": ..., "name": ..., "parameters": ...}`),
which the runner scored as a failure in **both** arms (23 pairs scored fail in both arms).
This depresses the absolute success rates symmetrically and was deliberately **not**
repaired after seeing the completed run, because amending a matcher after a verdict is
observed would invalidate the predeclaration. Absolute rates must therefore be read as a
lower bound; the arm comparison is the quantity the protocol predeclares.

The earlier connection problem is resolved: the credential was supplied by the repository
owner and passed as `TF0502_API_KEY` for this single run only; it is not written to any
file in this repository.

Superseded note: the endpoint was previously unreachable from the agent shell (HTTP 401,
`TF0502_API_KEY` unset). That probe and the aborted attempt produced no verdict; the
blocker was cleared by the owner-supplied credential.

## Acceptance mapping
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
| A/B first-call noninferiority + schema-token positive CI | **pass** (deciding run v2.1; v1 verdict retained as historical) | `ab-run-v2.json`; `ab-protocol-v2.json`; `raw-evidence.json#abV2` |

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
- The v1 non-inferiority check is defective (min/max pseudo-CI); its `fail`
  verdict is preserved unchanged as historical record and superseded by v2.1.
- v2.1 ignores invocation-form answers, so absolute success rates are a lower
  bound; the predeclared arm comparison is unaffected.
