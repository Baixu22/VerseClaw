---
id: fix-plugin-tools-descriptor-cache-performance
title: Reduce plugin tool descriptor construction latency
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: Eliminate repeated plugin tool-factory work during agent tool-list construction while preserving plugin policy checks, runtime execution, and registry reload correctness.
touchedAreas:
  - openclaw_runtime/src/plugins/tool-descriptor-cache.ts
  - openclaw_runtime/src/plugins/tools.ts
  - openclaw_runtime/src/plugins/tool-descriptor-cache.test.ts
  - openclaw_runtime/scripts/perf/issue-13-plugin-tools-descriptor-cache.ts
  - openclaw_runtime/package.json
  - reports/plugin-tools-descriptor-cache-benchmark-2026-08-12.json
  - harness/specs/tasks/fix-plugin-tools-descriptor-cache-performance.md
expectedUserBehavior:
  - A repeated agent tool-list construction can reuse plugin descriptors without rerunning an unchanged plugin tool factory.
  - Plugin tool allowlists, denylists, authentication availability, delivery context, and sandbox-sensitive contexts continue to determine visible tools.
  - A plugin registry replacement, reload, or Gateway lifecycle reset does not reuse descriptors from the retired registry.
requiredProfiles:
  - fast
requiredRules:
  - active-config-guards
  - capability-owner-resolution
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/fix-plugin-tools-descriptor-cache-performance.md
  - pnpm harness validate --spec harness/specs/tasks/fix-plugin-tools-descriptor-cache-performance.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.plugins.config.ts src/plugins/tool-descriptor-cache.test.ts
  - pnpm --dir openclaw_runtime perf:issue-13 -- --runs 5 --output ../reports/plugin-tools-descriptor-cache-benchmark-2026-08-12.json
  - pnpm --dir openclaw_runtime tsgo:core
acceptance:
  - Descriptor cache-key construction does not poll the plugin source with request-time filesystem stat calls.
  - Descriptor cache entries are scoped to active and channel plugin registry generations and clear at plugin metadata lifecycle boundaries.
  - Warm resolution avoids rerunning the descriptor factory, while the returned tool still resolves and executes the current runtime implementation.
  - The repeatable benchmark records cold and warm resolution timing, factory-call counts, and RSS for a real temporary plugin fixture.
  - A live Gateway stream-ready and RSS A/B measurement is recorded before closing GitHub issue 13 when a configured Gateway environment is available.
docs:
  required: false
  note: This is an internal runtime-performance change; the public README variants do not document plugin descriptor construction behavior.
---
