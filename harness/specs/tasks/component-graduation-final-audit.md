---
id: component-graduation-final-audit
title: Final component and Task Forest acceptance audit
lifecycleStatus: active
taskType: governance
intent: Read retained implementation and retirement evidence, reconcile the current authority and surface catalogs, and close the completed component program with truthful candidate and scope bindings.
touchedAreas:
  - harness/specs/tasks/model-capability-positioning-acceptance.md
  - harness/specs/tasks/component-graduation-final-audit.md
  - shared/dcs/component-disposition-catalog.ts
  - shared/component-authority-manifest.ts
  - docs/dev/component-disposition-matrix-20261021.md
  - docs/dev/default-config-matrix.md
  - docs/clawx-product-semantics.md
  - tests/unit/component-disposition-catalog.test.ts
  - docs/dev/vtoken-retirement-decision.md
  - docs/dev/component-graduation/TF-0507/**
  - docs/dev/component-graduation/TF-0508/**
  - docs/dev/versegit-product-integration/TF-0517/**
  - scripts/component-graduation-final-audit.mts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.knowledge.test.ts
  - scripts/repository-artifacts.json
  - .gitignore
  - shared/model-capability-profile.ts
  - tests/unit/model-capability-positioning-tf0507.test.ts
  - tests/unit/fixtures/model-capability-positioning-tf0507/**
  - scripts/model-capability-positioning.mts
  - scripts/verify-model-capability-positioning.py
  - docs/generated/catalogs/tools.md
  - docs/generated/catalogs/prod-flags.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredRules:
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredProfiles:
  - fast
requiredTests:
  - pnpm exec vitest run tests/unit/component-authority-manifest.test.ts tests/unit/component-disposition-catalog.test.ts tests/unit/component-graduation-report.test.ts
acceptance:
  - Every planned surface maps to one current disposition and implementation or retirement node; missing routes, duplicate accepting authorities and visible shadow surfaces are zero.
  - Read hashed per-component artifacts and preserve their original candidate identities; classification cannot replace implementation evidence.
  - Model positioning passes its complete declared protocol on the retained clean source candidate.
  - Current catalogs, defaults, product statements and retained evidence agree without changing frozen defaults or product locks.
  - Component closure and VerseGit closure use separate reports and proposals; historical whole-repository landing findings are retained separately.
  - Apply only fresh proposals, then read back validate/export and scoped default-branch reachability; local Task Forest history remains outside Git.
docs:
  required: false
---

All checks and verdicts are agent-driven. Retained historical runs keep their
original scope, dates, failure cases and measurements. A new audit does not turn
an unmeasured platform, provider, installed UI or general-availability boundary
into a pass. Source, fixtures and current implementation checks support routine
closure; publishing and frozen product decisions remain separate.
