---
id: nop-issue-fixes-batch1-20261010
title: Unprioritized issue batch 1 - vtoken contract, capability wiring map, reference analysis
lifecycleStatus: active
taskType: repo-governance
intent: Close the open issues that carry no priority prefix - vtoken distribution and format characterization plus its tracked tokenizer cache, the self-developed capability wiring map with a config-leaf consumer check, and the exact-path repository reference analysis that corrects the inflated zero-reference audit, while keeping the four tracking indexes accurate.
touchedAreas:
  - harness/specs/**
  - scripts/**
  - tests/unit/**
  - docs/**
  - packages/vtoken/**
  - .github/workflows/check.yml
  - .gitignore
  - .gitattributes
  - package.json
expectedUserBehavior:
  - The vtoken Python sidecar's distribution premise, its two independent call paths and the .vt format contract are documented with file-level evidence instead of open questions.
  - A machine-local tiktoken tokenizer cache is no longer tracked by Git and cannot silently reappear.
  - Every runtime feature config leaf has a consumer check; a newly declared leaf with no runtime consumer fails the check, while the leaves already known to be unwired stay pinned to the issue that owns them.
  - Repository cleanup decisions can be reproduced from an exact relative-path reference analysis instead of filename substring matching, and the two zero-code-reference documentation sets have an explicit archive conclusion.
requiredProfiles:
  - fast
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/repository-artifact-retention.test.ts
  - node node_modules/vitest/vitest.mjs run tests/unit/feature-leaf-consumers.test.ts
  - node node_modules/vitest/vitest.mjs run tests/unit/reference-graph-analysis.test.ts
  - node scripts/check-feature-leaf-consumers.mjs
  - node scripts/analyze-reference-graph.mjs --dir docs --zero-only
  - node scripts/check-repository-artifacts.mjs
  - node scripts/check-no-bom.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/nop-issue-fixes-batch1-20261010.md
acceptance:
  - Issue #97 - the uv/Python distribution premise, the vt.pack runtime call path and the .vt format stability contract each have a recorded conclusion with file-level evidence, and packages/vtoken/.tiktoken_cache is untracked while a guard keeps it out of the index.
  - Issue #96 - Q1 (coding.uftk leaf positioning), Q2 (DCS prod-flag control surface) and Q3 (UI exposure of self-developed capabilities) are answered from source, and scripts/check-feature-leaf-consumers.mjs fails closed for a newly declared leaf without a runtime consumer.
  - Issue #75 - scripts/analyze-reference-graph.mjs reproduces the corrected zero-reference counts from exact relative paths, any tracked claim still relying on the inflated figures is corrected or named, and docs/dev/context-control-plane plus docs/dev/knowledge-system-unification have an explicit archive conclusion with provenance.
  - Issues #103, #125, #147 and #158 remain open by design while their priority-prefixed children are open; their checklists are synchronised with the real GitHub child state and the audit is recorded.
docs:
  required: true
---

# Unprioritized issue batch 1

This batch works only the open issues whose titles carry no `[P*]` prefix. It
does not touch priority-prefixed issues, product defaults, feature flags,
permission defaults, frozen locks or release state.

The batch adds three pieces of durable machinery instead of one-off answers: a
config-leaf consumer check, an exact-path reference graph analysis, and a
vtoken contract record. Evidence is agent-driven; no human execution, human
data or third-party live call is claimed.
