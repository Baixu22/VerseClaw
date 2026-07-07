---
id: context-runtime-kit-default-on
title: Context Runtime Kit Default-On Promotion
scenario: context-runtime-kit
taskType: implementation
intent: Promote Context Runtime Kit from the completed shadow/report-only foundation to backend default-on context, prompt, and recovery behavior without UI changes or active tool-call blocking.
ownedPaths:
  - harness/specs/tasks/context-runtime-kit-default-on.md
  - harness/specs/rules/context-runtime-kit-boundary.md
  - harness/specs/scenarios/context-runtime-kit.md
  - docs/context-runtime-kit/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - tests/unit/context-runtime-kit-*.test.ts
  - tests/unit/context-engine-registry-default-on.test.ts
touchedAreas:
  - context-engine
  - runtime-config
  - compression-recovery
  - harness-specs
expectedUserBehavior:
  - When `plugins.slots.contextEngine` is omitted and `runtime.contextRuntimeKit.enabled` is not false, runtime backend uses the core-owned `context-runtime-kit` context engine by default.
  - Explicit `plugins.slots.contextEngine` values are respected, including `legacy`.
  - Setting `runtime.contextRuntimeKit.enabled: false` rolls backend context behavior back to `legacy` without UI involvement.
  - CRK failures quarantine the CRK engine for the process and fall back to `legacy`.
  - Tool-call gate diagnostics remain report-only and must not block tool execution.
requiredRules:
  - context-runtime-kit-boundary
  - workspace-harness-single-source
  - chat-loop-boundary
forbiddenPatterns:
  - renderer or host-api UI changes
  - i18n string changes for a settings UI
  - Electron E2E changes for settings UI
  - active tool-call blocking
  - Gateway transport or renderer protocol switching changes
  - large raw source chunks embedded directly in default prompt additions
  - new dependencies
  - parallel durable source of truth such as .trellis
requiredTests:
  - corepack pnpm harness context --spec harness/specs/tasks/context-runtime-kit-default-on.md
  - corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit-default-on.md
  - corepack pnpm exec vitest run tests/unit/context-runtime-kit-runtime-adapter.test.ts tests/unit/context-runtime-kit-active-engine.test.ts tests/unit/context-engine-registry-default-on.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --reporter=verbose
  - corepack pnpm run typecheck
  - git diff --check -- harness/specs/tasks/context-runtime-kit-default-on.md harness/specs/rules/context-runtime-kit-boundary.md harness/specs/scenarios/context-runtime-kit.md docs/context-runtime-kit openclaw_runtime/src/context-engine openclaw_runtime/src/config/types.openclaw.ts openclaw_runtime/src/config/zod-schema.ts tests/unit/context-runtime-kit-runtime-adapter.test.ts tests/unit/context-runtime-kit-active-engine.test.ts tests/unit/context-engine-registry-default-on.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts
acceptance:
  - This task is documented as a Phase 1-10 promotion task, not a replacement for the existing CRK foundation.
  - `ContextEngine.assemble()` accepts read-only active tool metadata, project context files, and skill metadata; existing engines may ignore those fields.
  - The runtime-to-CVK adapter converts tools, skills, and project context files into deterministic `CvkCompilerFixtureInput` without LLM extraction.
  - The core-owned `context-runtime-kit` engine preserves message history, returns a bounded `systemPromptAddition`, uses registry/compact selectors and diagnostics, and does not embed raw large chunks.
  - Default context engine resolution respects explicit slots, chooses CRK when the slot is absent and CRK is enabled, supports `enabled:false` rollback, and keeps `legacy` as the fixed fallback.
  - CRK factory, assemble, or compact failures are quarantined and fallback to `legacy` where the registry supports fallback.
  - Recovery uses selector-backed CRK projection only when Level 2 default-on gates pass and references are resolvable; missing, stale, secret-scan, or eval failures are visible and fall back to legacy projection.
  - Documentation explains default startup, rollback, and diagnostics without adding frontend UI.
docs:
  required: true
  note: Update CRK docs and README series only for backend default-on, rollback, and diagnostic behavior. Do not document a settings UI because this task intentionally does not add one.
---

# Context Runtime Kit Default-On Promotion

## Scope

This task starts after Context Runtime Kit Phase 1 through Phase 10 have established protocol types, compiler, resolver, views, shadow provider, report-only tool gate, additive compression fields, recovery context, codebase index, and eval reporting.

The promotion is backend-only. Context, prompt, and recovery paths may use CRK by default, but active tool-call blocking and frontend settings UI remain out of scope.

## Default Selection

- If `plugins.slots.contextEngine` is explicitly present, use that value exactly.
- If the slot is absent and `runtime.contextRuntimeKit.enabled !== false`, select `context-runtime-kit`.
- If `runtime.contextRuntimeKit.enabled === false`, select `legacy`.
- The fallback/default rollback engine remains `legacy`.
- Non-legacy failures are quarantined and downgraded to `legacy` according to the existing registry fallback semantics.

## Prompt Boundary

The active CRK engine may return `systemPromptAddition`, but it must be bounded and navigation-oriented. It may include registry entries, compact selector views, required selector refs, budget/eval/tool-gate diagnostics, and recovery diagnostics. It must not inject raw large chunks or replace transcript messages.

## Recovery Boundary

Selector-backed recovery is allowed only when the Level 2 default-on candidate gate passes and no required selector is missing, stale, or checksum-invalid. Secret scan failures and worst-case evidence failures block CRK recovery. Failure is visible in diagnostics and rolls back to legacy projection.

## Non-Goals

- No renderer, host-api UI, i18n, or Electron E2E work.
- No active tool-call blocking.
- No new dependencies.
- No new durable source of truth outside `harness/specs/**` and the existing runtime/doc locations.
