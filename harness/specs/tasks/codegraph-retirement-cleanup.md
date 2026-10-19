---
lifecycleStatus: active
id: codegraph-retirement-cleanup
title: Retire CodeGraph product surface while preserving impact parity evidence
type: task
scenario: context-runtime-kit
taskType: runtime-bridge
intent: Remove the retired CodeGraph plugin, packaging weight, and stale effectiveness gates without losing the frozen impact parity baseline that justifies the DCS replacement.
scenarios:
  - context-runtime-kit
requiredRules:
  - context-runtime-kit-boundary
  - repository-artifact-retention
requiredProfiles:
  - fast
touchedAreas:
  - openclaw_runtime/extensions/codegraph/**
  - openclaw_runtime/src/context-engine/views/impact/**
  - openclaw_runtime/src/context-engine/factstore/**
  - openclaw_runtime/src/agents/tools/context-agent-tools.ts
  - openclaw_runtime/scripts/check-codegraph-runtime-metrics.mjs
  - openclaw_runtime/package.json
  - tests/e2e/codegraph-plugin-tools-t3.spec.ts
  - tests/unit/runtime-effectiveness-eval.test.ts
  - tests/unit/helpers/runtime-effectiveness-eval.ts
  - scripts/runtime-long-stability.mjs
  - vitest.runtime-effectiveness.config.ts
  - package.json
  - harness/specs/fixtures/codegraph-retirement/**
  - harness/specs/tasks/codegraph-retirement-cleanup.md
  - artifacts/agent-dev-deep-test/**
  - artifacts/agent-dev-quality/**
  - artifacts/agent-dev-workbench/**
  - scripts/check-duplicate-assets.mjs
  - scripts/check-repository-artifacts.mjs
  - tests/unit/repository-artifact-retention.test.ts
  - openclaw_runtime/scripts/check-deprecated-zero-call.mjs
  - openclaw_runtime/extensions/diagnostics-otel/src/service.ts
  - docs/SEAM_MAP.md
  - docs/README.md
  - docs/enhancements/01-layered-execution-isolation.md
  - docs/enhancements/03-runtime-resilience-supervisor.md
  - openclaw_runtime/UPSTREAM.md
  - tests/unit/runtime-deep-refs.test.ts
  - eslint.config.mjs
  - harness/specs/tasks/runtime-component-effectiveness.md
  - openclaw_runtime/pnpm-lock.yaml
  - openclaw_runtime/scripts/lib/bundled-plugin-build-entries.mjs
  - openclaw_runtime/scripts/lib/static-extension-assets.mjs
  - openclaw_runtime/scripts/ts-max-loc-baseline.json
  - scripts/chain-audit/config/rpc-checks.json
  - scripts/check-runtime-source-policy.mjs
  - scripts/runtime-effectiveness.mjs
  - docs/dev/dcs-visible-production/RETIRED-SURFACES.md
  - docs/context-runtime-kit/**
  - docs/clawx-design-overview.md
  - .gitignore
expectedUserBehavior:
  - Users see DCS FactStore tools as the only supported coding-context path; no CodeGraph plugin or tool is advertised or bundled.
  - CodeGraph remains available only as historical evidence through a frozen parity fixture.
requiredTests:
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/views/impact/impact-parity.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/factstore/factstore.test.ts src/context-engine/factstore/materialize.test.ts src/context-engine/factstore/workspace-fact-service.test.ts
  - pnpm run build:runtime
  - pnpm run typecheck
acceptance:
  - The 13 golden impact queries and their CodeGraph 1.0.1 callers/impactFiles are frozen in a tracked fixture with source, license, version, query-shape, and fixture hashes.
  - The impact parity test reads the frozen fixture and no longer imports `extensions/codegraph/dist/index.js`.
  - The CodeGraph extension directory, plugin manifest, toggle-able tools, and package scripts are removed; historical enum compatibility and retirement docs remain.
  - The packaged runtime no longer contains `dist/extensions/codegraph` after `build:runtime`; a fresh package/asar readback is required before claiming installer-level removal.
  - Runtime effectiveness and long-stability no longer require a CodeGraph self-test lane; DCS `context_impact` and frozen parity remain covered.
  - Local `.codegraph/` index and the `codegraph-removal-probe-20261017` temporary copy are either removed under a verified target boundary or left with an explicit owner-readable retention reason.
  - All commands, exit codes, counts, artifact hashes, residual boundaries, and any stale-tree caveat are recorded in one final report.
nonGoals:
  - Re-enable or upgrade CodeGraph.
  - Replace DCS FactStore or remove legacy stored-block enum compatibility.
  - Change product defaults, publish, or claim GA.
---

# CodeGraph Retirement Cleanup

This task follows TASK-P0-06 and the context-engine rebuild retirement decision. The plugin is already marked RETIRED and default-off; this task removes the remaining product/package surface while preserving the evidence needed to validate the replacement.

## Ordering

1. Freeze the 13-query impact baseline.
2. Point the parity test at the frozen fixture.
3. Remove plugin, E2E, package scripts, and effectiveness coupling.
4. Rebuild and inspect the packaged runtime.
5. Remove local caches only after path, size, and target-boundary checks.
6. Record the final evidence and residual boundaries.

## Non-negotiable boundary

The parity fixture may preserve a CodeGraph measurement, but the repository must not retain a loadable CodeGraph product plugin solely to regenerate that measurement. Regeneration, if ever needed, is a one-time external MIT-source operation documented in the fixture provenance.

## Verification notes

- `pnpm run build:runtime` proves runtime construction and startup smoke, not a fresh installer.
- A release/asar readback is required for package-level removal claims.
- Windows Electron E2E requires Node 24.16+; if unavailable, record the blocker rather than substituting a unit test.

