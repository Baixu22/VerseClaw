# SEKB Hermes Tier B Grayscale Observation

- runId: `b-gray-2026-07-14T16-32-03-287Z-a0ba48bd`
- generatedAt: 2026-07-14T16:32:04Z
- authority: offline evaluation evidence only (not runtime source of truth)
- promotion: **shadow_only** / evaluable_for_promotion=**false**

## Flags
- master enabled: true
- shadow enabled: true
- batch enabled: false (must stay false in Tier B)
- stateDir: `C:\Users\27933\AppData\Roaming\Electron\openclaw-source-state`
- config: `C:\Users\27933\AppData\Roaming\Electron\openclaw-source-state\openclaw.json`

## Inventory
- sqlite trajectories: **105**
- export records: **105**
- match: **true**
- sqlite bytes: 1421312
- principles: 0
- batch events: 0

## Distributions
### task_type
```json
{
  "docs/config": 22,
  "config/db": 22,
  "ops/debug": 21,
  "ops/auth": 20,
  "eval/protocol": 20
}
```

### classifier collapse check
```json
{
  "distinctTaskTypes": 5,
  "agentTaskCount": 0,
  "agentTaskRatio": 0,
  "collapsedToAgentTask": false,
  "note": "task_type distribution has meaningful spread (or smoke scenarios forced types)"
}
```

### shadow scores
```json
{
  "withMetadata": 105,
  "withoutMetadata": 0,
  "scoreBuckets": {
    "0-24": 0,
    "25-49": 0,
    "50-74": 43,
    "75-100": 62,
    "missing": 0
  },
  "retain": 105,
  "reviewLowSignal": 0,
  "retainRatio": 1,
  "metadataBytes": {
    "max": 993,
    "over2KiB": 0
  }
}
```

## Privacy
- ok: **true**
- sample keys: trajectoryId, terminalOutcome, counts, shadow, error

## Operator report
- evidence state: **ready**

## Offline report (unfilled grayscale reviews)
```json
{
  "status": "insufficient_data",
  "promotion": {
    "status": "shadow_only",
    "blockers": [
      "reviewed_samples_below_200",
      "cohens_kappa_no_independent_review_pairs",
      "valuable_recall_no_consensus_labels",
      "projected_false_drop_no_consensus_labels"
    ]
  }
}
```

## Findings
### P0 (0)
- none

### P1 (1)
- `high_shadow_retain_ratio`: Expected while capture value != task success; do not retune Shadow V1 threshold in Tier B.

## Tier C readiness (traffic/stability only)
- ready: **true**
- blockers: none
- warnings: trajectory_count_below_200_human_dual_review_target, very_high_retain_ratio_expected_because_capture_value_neq_task_success
- note: Traffic/stability premises for Tier C dual-review campaign look acceptable; human dual review still required and promotion remains deferred.

## Explicit non-goals
- No fabricated human dual-review labels
- No Shadow V1 retune
- No Phase C/D activation
- No automatic principle writes
- No production benefit claim from grayscale alone
