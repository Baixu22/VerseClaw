# SEKB Hermes Tier C Human Dual-Review Labeling Protocol

## Purpose
Independent human labels for offline shadow evaluation. Artifacts are non-authoritative.

## Labels
- `valuable` - worth retaining for human distillation
- `not_valuable` - low signal / not reusable
- `uncertain` - insufficient privacy-bounded evidence

## Independence
1. Two reviewers label the same protocol sample without seeing each other.
2. Use `reviewer-A.worksheet.v1.json` and `reviewer-B.worksheet.v1.json`.
3. Never copy `automated_smoke_not_human` labels.
4. Do not chase -/recall after seeing the report except formal adjudication.

## Inputs allowed
terminalOutcome, counts, shadow score/factors/completionStatus, error signature presence + recurrenceCount, stratum.

## Holdout
Deterministic stratified; development and holdout separate. Shadow V1 threshold frozen at 50; no holdout retune.

## Minimum
>= 200 trajectories - 2 independent humans.

## After labeling
1. `node scripts/sekb-tier-c-campaign.mjs --merge-worksheets`
2. Resolve disagreements (DISAGREEMENT-RESOLUTION.md)
3. Re-run campaign / report
4. Read GO-NO-GO.md
