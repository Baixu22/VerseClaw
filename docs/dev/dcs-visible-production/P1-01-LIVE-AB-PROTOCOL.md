# TASK-P1-01 live A/B protocol (draft)

> **Status:** protocol + synthetic baseline ready; human free-form A/B residual.  
> **Does not** set liveReady=true or productApproved=true.

## Goal

Measure whether Fact view tools (context_understand / impact / reuse / verify) reduce tool churn vs baseline grep/read without lowering task pass rate.

## Arms

| Arm | Enablement | Expected tools |
|-----|------------|----------------|
| **A baseline** | view tools OFF (default) | grep/read/edit/write only |
| **B factstore** | Settings → enable context-view-tools OR env `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1` + restart | + four view tools when FactService available |

## Session rules

1. Same workspace, same model, same task list (min 10 coding tasks).
2. Operator records each run with OPS-01 run template fields.
3. Kill after session: Settings off + smoke (OPS-02 order).
4. No default flips.

## Metrics

- tool call count (total / search-like)
- task pass (human judgment 0/1)
- latency p50/p95
- unauthorized write = 0
- routing accuracy (optional)

## Synthetic scale reference (already on disk)

`artifacts/dcs-canary/c1/decision.json`:

- fixtureCount 32, reductionFactor **5.125**, pass rates 1.0
- recommendation **keep-off**, liveReady **false**, productApproved **false**

This is simulated-arm evidence and is not the C1 gate authority. The unified
FP-P4-05 decision is `artifacts/first-product-preview/FP-P4-05/decision.json`:
the four hand-authored fixtures that execute real context tools are authoritative
at **4.5x**, below the unchanged 5x threshold. Historical 5.125x remains a
reference-only scale result.

## Live report path (when humans execute)

Write: `artifacts/tf0006-evidence-upgrade/live-ab-report.json` (or `artifacts/dcs-visible-production/p1-01-live-ab.json`) with:

```json
{
  "schema": "dcs-view-tools-live-ab/v1",
  "live": true,
  "cohortSize": 0,
  "arms": { "baseline": {}, "factstore": {} },
  "winLossTie": { "win": 0, "loss": 0, "tie": 0 },
  "safetyIncidents": 0,
  "optOutPath": "Settings off / unset env + restart",
  "productApproved": false
}
```

## Exit for default-on discussion

Requires TF-0006 pack + productApproved — **out of scope for P1-01 close**.
