---
id: p3-policy-doc-truthfulness
title: P3 policy documentation truthfulness (issues 133 and 152)
type: task
diffBase: HEAD
requiredRules:
  - product-policy-doc-truthfulness
  - docs-sync
  - repository-artifact-retention
intent: Close the two P3 audit issues where published documentation disagreed with the shipped implementation — SECURITY.md was still the GitHub template, and the Main-process acceleration comment promised CLI/config switches that do not exist — and add a fail-closed check so neither can drift back.
expectedUserBehavior:
  - SECURITY.md states the real support scope for the private alpha, keyed to the version in package.json, and states explicitly that no response time or SLA is committed.
  - SECURITY.md gives a private reporting path that works without publishing the repository, and warns against sending live credentials.
  - The hardware acceleration comment describes the shipped behaviour and names no switch that does not exist, with the frozen default recorded in a decision document.
  - A single agent-driven command fails when a policy document regains template text, drifts from the manifest version, links to a missing file, or promises an unimplemented switch.
touchedAreas:
  - SECURITY.md
  - docs/dev/hardware-acceleration-policy.md
  - electron/main/index.ts
  - scripts/validate-policy-docs.mjs
  - scripts/validate-policy-docs.d.mts
  - tests/unit/policy-doc-truthfulness.test.ts
  - harness/specs/rules/product-policy-doc-truthfulness.md
  - harness/specs/tasks/p3-policy-doc-truthfulness.md
  - scripts/repository-artifacts.json
  - .gitignore
  - package.json
  - .github/workflows/check.yml
residualPaths:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - openclaw_runtime/src/agents/provider-http-errors.ts
  - openclaw_runtime/src/gateway/openai-compat-errors.ts
  - openclaw_runtime/src/gateway/openai-http.ts
  - openclaw_runtime/src/gateway/openresponses-http.ts
  - openclaw_runtime/src/infra/retry.ts
  - docs/dev/error-governance-audit-2026-10-09.md
  - docs/dev/harness-gap-closure/design.md
  - docs/dev/provider-error-retry-boundaries.md
  - docs/dev/repository-cleanup-triage-2026-10-08.md
  - docs/dev/security-reality-audit-20261009.md
  - docs/dev/windows-runtime-efficiency-observability.md
  - electron/services/efficiency-orchestrator.ts
  - electron/services/efficiency-power-policy.ts
  - electron/services/efficiency-sampler.ts
  - harness/specs/rules/provider-error-retry-boundaries.md
  - harness/specs/rules/runtime-efficiency-observability-boundary.md
  - harness/specs/tasks/harness-gap-closure-plan.md
  - harness/specs/tasks/provider-error-retry-boundaries.md
  - harness/specs/tasks/windows-runtime-efficiency-observability-v1.md
  - scripts/validate-runtime-efficiency.mjs
  - tests/unit/agent-trace-graph-layout-bench.test.ts
  - tests/unit/provider-error-http-boundaries.test.ts
  - tests/unit/provider-error-retry-boundaries.test.ts
  - tests/unit/runtime-efficiency-power-policy.test.ts
  - tests/unit/runtime-efficiency-sampler.test.ts
docs:
  required: true
  paths:
    - docs/dev/hardware-acceleration-policy.md
requiredTests:
  - pnpm docs:policy:validate
  - pnpm exec vitest run tests/unit/policy-doc-truthfulness.test.ts --maxWorkers=1
  - pnpm harness validate --spec harness/specs/tasks/p3-policy-doc-truthfulness.md
acceptance:
  - SECURITY.md contains none of the GitHub template sentences and none of the sample 5.1.x/5.0.x/4.0.x rows.
  - SECURITY.md names the exact version from package.json and the maintained ref, and the check fails when the manifest version changes without the document.
  - SECURITY.md defines a private reporting path (Baixu22/VerseClaw issues), forbids pasting live credentials, records that GitHub private vulnerability reporting is not enabled, and commits to no SLA.
  - SECURITY.md points at the Findings registry and the security regression suite; the check fails if those assets disappear.
  - Every repository path referenced by SECURITY.md and the acceleration decision record resolves on disk, and the check fails closed on a missing document instead of skipping it.
  - electron/main/index.ts names no non-existent acceleration switch; docs/dev/hardware-acceleration-policy.md records the frozen default, the rationale, the absent switches, the required change path, and the missing performance baseline.
  - The shipped runtime default is unchanged: app.disableHardwareAcceleration() is still called unconditionally and no new switch or config key is introduced.
  - Evidence is agent-driven and synthetic; no claim of real-human review, penetration testing, or live exploitation is made.
---

## Scope

Documentation truthfulness plus its automated check. The two P3 issues are closed
by correcting the documents and by making the correction machine-checkable.

## Explicit non-goals

- No product-lock or frozen-default change. The hardware acceleration default
  stays exactly as it is; the decision record documents the lock rather than
  opening it. Offering an opt-in acceleration surface is a publisher decision and
  is listed as a precondition in the decision record, not implemented here.
- No new public contact address, security email, bug bounty or SLA. The private
  repository issue path is described as it is.
- No change to Theme/UI, host-api, gateway or runtime behaviour; the only
  product source touched is a comment block in the Main process.
- No expansion of the security audit program: the issues registered by
  `docs/dev/security-reality-audit-20261009.md` other than #133 are untouched.

## Concurrent workspace residuals

The `residualPaths` entries above are pre-existing or concurrent work from other
sessions (provider error retry boundaries, runtime efficiency observability, the
harness gap plan, and the audit reports that registered these issues). They are
not owned, changed or accepted by this task. They stay visible to the diff-aware
gate; no `--no-diff`, no wildcard residual and no product-lock change is used.
