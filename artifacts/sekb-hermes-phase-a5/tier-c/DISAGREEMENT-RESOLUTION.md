# SEKB Hermes Tier C Disagreement Resolution

## Definition
Reviewer A label - Reviewer B label after both labeled.

## Report behavior
Unresolved disagreements block promotion until count is 0.
Resolution = both reviewers update to the same final label (or both uncertain).

## Process
1. Read tier-c/disagreements.v1.json
2. Adjudicate using export fields + protocol definitions only
3. Calibration notes for 5-10 hard cases
4. Both re-label worksheets
5. Re-merge and re-report
6. Log in DISAGREEMENT-RESOLUTION-LOG.md

## Forbidden
- automated_smoke tie-breaks
- Shadow V1 threshold/weight changes
- Dropping disagreed items without protocol replacement
- Fabricating consensus for gates
