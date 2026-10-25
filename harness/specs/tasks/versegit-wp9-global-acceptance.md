---
lifecycleStatus: active
id: versegit-wp9-global-acceptance
title: WP9 - VerseGit whole-goal acceptance aggregation and lifecycle closeout
scenario: versegit-validation-layer-extension
taskType: closeout
intent: Aggregate every TF-0465 acceptance criterion, all required child states, the corrected WP7 live slice and the WP8 independent verdict into one reproducible non-GA lifecycle decision without creating a second execution or release authority.
touchedAreas:
  - harness/specs/tasks/versegit-wp9-global-acceptance.md
  - harness/specs/guides/versegit-concurrency/wp9-lifecycle-closeout.md
  - docs/dev/versegit-validation-layer/README.md
  - harness/specs/fixtures/versegit-planning-correction/wp9-global-acceptance-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/wp9-evidence/**
  - artifacts/versegit/wp9/**
  - scripts/versegit-wp9-global-acceptance.mjs
  - scripts/verify-versegit-wp9.mjs
  - tests/unit/versegit-wp9-global-acceptance.test.ts
expectedUserBehavior:
  - WP9 reads the live Task Forest graph before closing the goal and rejects any required child that is not done or explicitly deprecated.
  - Every TF-0465 acceptance criterion has direct disk evidence plus explicit verified, not_applicable or retired disposition.
  - WP6 and WP8 evidence are revalidated through their independent verifiers before their facts are aggregated.
  - The final verdict is non-GA PASS_WITH_GAPS when P0 and P1 are zero but residual P2 and unmeasured boundaries remain.
  - The report preserves default-off, landed-unwired, release-ineligible and M4-unauthorized posture and never claims human evidence.
  - The goal closes only through a Task Forest proposal after the report, manifest, SHA256SUMS and independent verifier pass.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/versegit-wp9-global-acceptance.mjs --fixture harness/specs/fixtures/versegit-planning-correction/wp9-global-acceptance-fixture.json --out artifacts/versegit/wp9/global-report.json
  - node scripts/verify-versegit-wp9.mjs
  - pnpm exec vitest run tests/unit/versegit-wp9-global-acceptance.test.ts
  - node scripts/verify-versegit-wp8.mjs
  - node scripts/validate-versegit-planning-correction.mjs
  - pnpm harness validate --spec harness/specs/tasks/versegit-wp9-global-acceptance.md
acceptance:
  - Every TF-0465 acceptance criterion has a typed disposition and digest-bound evidence; no criterion is implicitly treated as passed.
  - Every required child is done or deprecated, every blocking dependency resolves to done/deprecated, and no child remains in an open or blocked queue.
  - The report passes only when WP6 and WP8 verifiers pass, WP8 has P0=0/P1=0, and the corrected WP7 candidate identity is resolvable.
  - The final lifecycle decision preserves singleGreenLight=false, defaultOn=false, ga=false, releaseEligible=false, m4Authorized=false and humanEvidence=false.
  - WP8 P2 residuals plus platform, language, read-surface, provider, release and M4 boundaries remain explicit in the final report.
  - The final report, manifest and both SHA256SUMS surfaces are reproducible, and negative tampering is rejected by the WP9 verifier tests.
  - Task Forest closeout changes TF-0515 and TF-0465 to done only after the evidence artifacts pass on disk.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/wp9-lifecycle-closeout.md
    - docs/dev/versegit-validation-layer/README.md
---

# WP9 whole-goal acceptance

WP9 is the sole aggregation authority for `TF-0465`. It does not execute a new
verseGit workflow and does not elevate evidence into product approval. It proves
that the complete non-GA host-module lifecycle is coherent:

```text
live Task Forest child states
  + WP0-WP6 / MC0-MC6 retained gates
  + WP7 corrected bounded live host slice
  + WP8 independent PASS_WITH_GAPS
  + residual and authority boundaries
  -> WP9 PASS_WITH_GAPS
```

`passed=true` means the engineering evidence chain is reproducible and the goal can
close with retained gaps. It never means GA, default-on, release eligibility, a real
external-model session, full product M3, or M4 landing authority.
