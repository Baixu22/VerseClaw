---
id: p2-issue-fixes-batch15-20261010
title: P2 issue batch 15 - merge LoCoMo cached/fresh mirrored tails
lifecycleStatus: active
taskType: test-maintainability
intent: Remove the ~1300-line verbatim mirror between the cached and fresh LoCoMo evaluation paths by extracting one shared post-retrieval tail, so escalation / reflect / judge / context-recall changes can no longer be applied to only one path and silently diverge.
touchedAreas:
  - tests/unit/**
  - scripts/**
  - docs/**
  - docs/README.md
  - harness/specs/**
expectedUserBehavior:
  - Cached and fresh retrieval paths still behave exactly as before; only the retrieval result, re-retrieval strategy and cache-write hook are injected into the shared tail.
  - Editing the escalation ladder, reflect agent, judge, recall or taxonomy code now changes both paths at once.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
humanEvidence: not-required
forbiddenPatterns:
  - changing cached or fresh retrieval semantics, sampling, thresholds or report fields
  - collapsing the two retrieval paths into one (they legitimately differ)
  - relying on the end-to-end LoCoMo A/B alone as equivalence proof
  - deleting the mirror without recording why the A/B is not itself reproducible
requiredTests:
  - node scripts/check-locomo-merge-equivalence.mjs
  - pnpm run typecheck:test
  - pnpm harness validate --spec harness/specs/tasks/p2-issue-fixes-batch15-20261010.md
acceptance:
  - Issue #144 - runtime-memory-locomo-full-500.test.ts declares exactly one shared post-retrieval tail and both retrieval paths call it with injected parameters.
  - Issue #144 - cached path keeps cached hop answers as L1 reasoning hints, captures re-retrieved facts and keeps its full-pipeline re-retrieval; fresh path keeps no hop hints, does not capture, uses plain top-10 and still writes the dev-slice cache.
  - Issue #144 - the previously mirrored constructs (escalation ladder, reflect agent, judges, context recall, error taxonomy, feedback rewrite) each exist once.
  - Issue #144 - the file shrank materially and the change is documented with the measured reason the end-to-end A/B is not itself a reproducible oracle.
docs:
  required: true
  files:
    - docs/dev/p2-issue-fixes-batch15-20261010.md
---

# P2 issue batch 15

This batch addresses issue #144. The cached and fresh LoCoMo evaluation paths
carried two verbatim copies of the same post-retrieval tail. They now share one
implementation, with the retrieval result, re-retrieval strategy and cache-write
hook injected, so a change cannot land in only one path.