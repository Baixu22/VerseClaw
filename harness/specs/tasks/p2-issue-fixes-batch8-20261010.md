---
id: p2-issue-fixes-batch8-20261010
title: P2 issue batch 8 - masked archive recall and pre-truncation native output capture
lifecycleStatus: completed
scenario: context-runtime-kit
taskType: runtime-bridge
intent: Close #113 and #114 by giving the model a session-bound, bounded archive recall tool and by persisting native/PTY output before the process registry performs its first lossy cap.
touchedAreas:
  - openclaw_runtime/src/agents/tools/context-agent-tools.ts
  - openclaw_runtime/src/agents/tool-catalog.ts
  - openclaw_runtime/src/agents/tool-display-config.ts
  - openclaw_runtime/src/agents/write-destructive-tier.ts
  - openclaw_runtime/src/agents/bash-raw-output-capture.ts
  - openclaw_runtime/src/agents/bash-process-registry.ts
  - openclaw_runtime/src/agents/bash-tools.exec-runtime.ts
  - openclaw_runtime/src/agents/bash-tools.exec-types.ts
  - openclaw_runtime/src/agents/bash-tools.exec.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.ts
  - openclaw_runtime/src/context-engine/registry/context-item-registry.ts
  - openclaw_runtime/src/context-engine/coding-tool-navigation.ts
  - openclaw_runtime/scripts/ts-max-loc-baseline.json
  - tests/unit/**
  - docs/dev/p2-issue-fixes-batch8-20261010.md
expectedUserBehavior:
  - A model that receives a masked observation placeholder can call a built-in recall tool, receive a bounded session-owned excerpt, and reject handles from another session.
  - Large native command output is archived before the in-memory aggregate is capped, so later recovery can still return head and tail markers that the capped message no longer contains.
requiredProfiles:
  - fast
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/context-archive-recall.test.ts tests/unit/native-raw-output-archive.test.ts tests/unit/native-raw-output-archive-reuse.test.ts tests/unit/context-observation-masking.test.ts --reporter=dot
  - node openclaw_runtime/node_modules/vitest/vitest.mjs run --config openclaw_runtime/test/vitest/vitest.agents-tools.config.ts openclaw_runtime/src/agents/tools/context-agent-tools.test.ts --reporter=dot
  - node openclaw_runtime/node_modules/vitest/vitest.mjs run --config openclaw_runtime/test/vitest/vitest.agents.config.ts openclaw_runtime/src/agents/bash-tools.process.lifecycle.test.ts openclaw_runtime/src/agents/bash-tools.characterization.test.ts --reporter=dot
  - pnpm runtime:source:check
  - pnpm run typecheck:test
  - pnpm --dir openclaw_runtime exec node scripts/run-tsgo.mjs -p tsconfig.core.json --noEmit
  - pnpm --dir openclaw_runtime exec node scripts/run-tsgo.mjs -p tsconfig.extensions.json --noEmit
acceptance:
  - Issue #113 - observation masking emits a placeholder naming a model-callable bounded recall tool; the tool verifies the archive checksum and session owner, rejects cross-session handles, and returns bounded content with char/byte counts and a truncation flag.
  - Issue #114 - ordinary native/PTY output is captured to a bounded pre-loss artifact before appendOutput caps aggregate/pending output; a verified archive handle is attached to the exec result and reused by tool-result truncation instead of archiving the already-capped payload.
docs:
  required: true
---

# P2 issue batch 8

This batch closes the two archive-boundary P2 issues. It reuses the existing
Context Family archive owner and process registry, does not change the default
observation-masking switch, does not add a new archive store, and does not
change product permission defaults. Evidence is agent-driven.
