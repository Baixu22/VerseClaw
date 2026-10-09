---
id: capability-registry-v3-skill-resolver
title: Capability Registry V3 Skill hierarchical resolver
scenario: capability-registry-v3
taskType: runtime-shadow
diffBase: fafa493fabd7e7c0c448f6b0a275c87eb13afb46
intent: Implement V3-02 as a default-disabled, caller-owned Skill discovery projection over the V3 shadow catalog without changing any active Skill or prompt behavior.
ownedPaths:
  - docs/dev/capability-registry-v3-development-plan.md
  - docs/dev/capability-registry-v3-foundation-acceptance.md
  - docs/dev/capability-registry-v3-skill-resolver-acceptance.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-foundation.md
  - harness/specs/tasks/capability-registry-v3-skill-resolver.md
  - openclaw_runtime/src/capabilities/v3/**
touchedAreas:
  - docs/dev/capability-registry-v3-development-plan.md
  - docs/dev/capability-registry-v3-skill-resolver-acceptance.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-skill-resolver.md
  - openclaw_runtime/src/capabilities/v3/**
expectedUserBehavior:
  - Existing Skill loading, Skill prompt bytes, Tool availability, approval, retry, transcript, storage, Host API, and UI behavior remain unchanged.
  - Explicit callers can build a deterministic category -> namespace -> candidate Skill projection from a validated V3 shadow catalog.
  - Disabled resolution returns no projection and performs no active prompt or loader work.
requiredProfiles:
  - fast
requiredRules:
  - capability-registry-v3-boundary
forbiddenPatterns:
  - changes to openclaw_runtime/src/skills/loading, formatSkillsForPrompt, prompt construction, Tool Search, Code Mode, DCS handlers, MCP materialization, Host API, Electron, Renderer, approval, retry, or persistence
  - descriptor executors, Skill body contents, credentials, raw outputs, durable storage, or an active runtime feature configuration
  - arbitrary text truncation used to satisfy the L0 budget
featureFlags:
  - The resolver accepts an explicit caller-owned enabled input and defaults to disabled. No application configuration or active flag wiring is added in V3-02.
rollback:
  - Stop calling the unused resolver or remove its pure V3 module. It creates no runtime state, prompt mutation, storage, or user-visible configuration.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/capability-registry-v3-skill-resolver.md
  - pnpm harness validate --spec harness/specs/tasks/capability-registry-v3-skill-resolver.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/capabilities/v3/capability-descriptor.test.ts src/capabilities/v3/shadow-catalog.test.ts src/capabilities/v3/evaluation-baseline.test.ts src/capabilities/v3/skill-resolver.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run lint:check
  - pnpm run typecheck
  - git diff --check
acceptance:
  - The Skill resolver consumes only caller-owned V3 shadow catalog metadata and filters to Skill descriptors.
  - L0 is structurally folded as category plus searchable trigger keywords, with both context-window-share and entry-count caps enforced without arbitrary text truncation.
  - Small, stable catalogs bypass retrieval only when the complete metadata projection fits explicit calibrated caller thresholds.
  - Retrieval ordering and category/namespace/candidate Recall@1 evaluation are deterministic across input order.
  - With enabled omitted or false, the resolver returns no projection and does not alter any active Skill loader or prompt path.
docs:
  required: true
  files:
    - docs/architecture-overview.md
    - docs/dev/capability-registry-v3-skill-resolver-acceptance.md
---

# Capability Registry V3-02: Skill Hierarchical Resolver

This package is limited to pure, explicit caller input under
`openclaw_runtime/src/capabilities/v3/`. It may construct an inspectable
projection of existing descriptor metadata, but it must not import a Skill
loader, read a Skill body, format a prompt, or modify a runtime path.

The L0 budget is deliberately supplied by the caller as a context-window share
and an entry cap. V3-02 does not promote the planning document's illustrative
numbers into global defaults. Candidate descriptions remain L2 data; L0 uses
only structured category and trigger-keyword navigation.
