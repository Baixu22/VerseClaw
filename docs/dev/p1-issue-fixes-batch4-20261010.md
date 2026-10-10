# P1 batch 4: verifier authority and evaluation honesty

- Date: 2026-10-10
- Issues: #106, #139, #140, #142
- driven_by: agent
- actor: codex-p1-batch4

## Implemented behavior

1. **#106** - `outcome.status=ok` is no longer converted to a pass. The
   verifier prompt requires `verificationVerdict=pass|fail|repair_required`;
   missing or invalid structured verdicts fail closed, and the team status
   projection consumes the same report decision.
2. **#139** - `pairedTTest` now computes a real two-sided Student t p-value
   with a regularized incomplete beta implementation. Tests assert a
   continuous small p-value for varied differences.
3. **#140** - judge sanity reports expose `status`, `reviewCoverage`, and
   `requiresPromptReview: null` when no samples have been reviewed. An
   unreviewed gate is no longer rendered as healthy.
4. **#142** - `MultiTurnQueryPlan` budget fields are optional and the
   aggregate report evaluation alternates explicit overrides with production
   defaults instead of replacing missing values with 512/8.

## Verification boundary

These changes make synthetic evaluation failures honest. They do not add a live
model closure, a human judge, or a new memory-benefit claim; those remain
separate evidence questions.
