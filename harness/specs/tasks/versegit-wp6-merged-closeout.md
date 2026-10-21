---
lifecycleStatus: active
id: versegit-wp6-merged-closeout
title: WP6 - merged migration closeout and M4 decision boundary
scenario: versegit-validation-layer-extension
taskType: closeout
intent: Aggregate MC0-MC5 and WP0-WP5 evidence, recompute their digest manifests, seal the optional MC6 sidecar-only decision, and record a non-GA lifecycle posture that preserves host authority, release blockers, unobserved surfaces and the unauthorized M4 boundary.
touchedAreas:
  - harness/specs/tasks/versegit-wp6-merged-closeout.md
  - harness/specs/tasks/versegit-mc6-extraction-decision.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - harness/specs/guides/versegit-concurrency/implementation-roadmap-and-acceptance.md
  - harness/specs/guides/versegit-concurrency/versegit-migration-control-plan.md
  - harness/specs/guides/versegit-concurrency/versegit-planning-correction-matrix.md
  - docs/dev/versegit-validation-layer/README.md
  - harness/specs/fixtures/versegit-planning-correction/wp6-closeout-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/wp6-evidence/**
  - harness/specs/fixtures/versegit-planning-correction/mc6-extraction-decision-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/mc6-evidence/**
  - artifacts/versegit/wp6/**
  - artifacts/versegit/mc6/**
  - scripts/versegit-wp6-closeout.mjs
  - scripts/verify-versegit-wp6.mjs
  - scripts/verify-versegit-mc6.mjs
  - tests/unit/versegit-wp6-closeout.test.ts
expectedUserBehavior:
  - The closeout report identifies every required MC0-MC5 and WP0-WP5 gate with its task spec, verifier, curated evidence, artifact alias where one exists, schema and digest.
  - All pre-closeout evidence manifests are recomputed and any stale or malformed entry rejects the closeout.
  - The optional MC6 decision records sidecar-only because no measured in-process requirement exists; source extraction remains not triggered.
  - The report preserves hostVerdict=unchanged, singleGreenLight=false, defaultOn=false, ga=false and releaseEligible=false.
  - No live VerseShell receipt, conflicts-plan seam, M4 broker, land/admit path or real-agent invocation is claimed.
  - Unobserved read surfaces, partial language coverage, Windows-only execution and release blockers remain explicit.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/versegit-wp6-closeout.mjs --fixture harness/specs/fixtures/versegit-planning-correction/wp6-closeout-fixture.json
  - node scripts/verify-versegit-wp6.mjs --artifact artifacts/versegit/wp6/final-report.json
  - node scripts/verify-versegit-mc6.mjs --artifact artifacts/versegit/mc6/decision.json
  - pnpm exec vitest run tests/unit/versegit-wp6-closeout.test.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-wp6-merged-closeout.md
acceptance:
  - All twelve required child gates exist and their task specs, verifiers, curated reports, schema identities and artifact aliases are present; TF-0480 is explicitly deprecated and merged.
  - Every required evidence manifest is recomputed from its listed files with zero missing files and zero digest mismatches.
  - Credential-pattern scanning covers the retained evidence and static closeout inputs with zero hits.
  - The closeout remains non-GA and release-ineligible with the dirty-source and release-binary blockers retained; evidence closure is not promoted to product approval.
  - host verdict stays unchanged, singleGreenLight stays false, no land/admit or VG process is run, and M4 remains unauthorized.
  - The current conflicts-plan seam is unavailable, no live VerseShell receipt is claimed, and shell/direct-fs/arbitrary-MCP/network/browser gaps remain visible.
  - The optional MC6 decision is reproducible, sidecar-only, source-extraction-not-triggered and includes a rollback and reopen policy.
  - Curated final report, manifest and SHA256SUMS are independently reproducible.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/implementation-roadmap-and-acceptance.md
    - docs/dev/versegit-validation-layer/README.md
---

# WP6 merged closeout

WP6 closes the engineering evidence chain, not the product release. `passed` means the
aggregated facts and their boundaries are reproducible, not that VerseGit is GA,
default-on, release-eligible or authorized to land.

## Closeout order

```text
required gate discovery
  -> schema/spec/verifier presence
  -> artifact versus curated semantic identity
  -> pre-closeout SHA256SUMS replay
  -> MC6 sidecar-only decision
  -> authority / coverage / platform / release posture
  -> manifest + final SHA256SUMS
  -> independent verifier and clean-worktree harness validation
```

The closeout never reruns a child gate's provider behavior by silently starting VG.
It verifies the artifacts and evidence retained by those gates. Runtime reruns remain
owned by the individual verifiers and the checked-in test matrix.

## Non-GA posture

The current package remains rejected because the provider source was dirty and no
release binary exists. The debug sidecar and all evidence are useful integration
artifacts, but they do not authorize release, default-on, `vg land`, `vg admit`, or an
M4 CAS landing broker.
