---
lifecycleStatus: active
id: context-ladder-assembler-wiring
title: Wire explicit context ladder into assembler pressure selection
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 34e0263a2
intent: >-
  Wire applyContextLadder into the production assembler through an explicit
  request opt-in with a token budget. Enabled requests query session blocks once,
  run the ladder, and use only active blocks for DCS channel injection. Omitted
  requests keep the ordinary per-channel path byte-identical, and ladder failures
  fall back to that ordinary path instead of breaking assembly.
scenarios:
  - gateway-backend-communication
requiredProfiles:
  - fast
  - comms
requiredRules:
  - active-config-guards
  - coding-runtime-workspace-dcs-producer-boundary
expectedUserBehavior:
  - Callers can pass contextLadder={enabled:true,tokenBudget,...} to Assembler.assemble.
  - Enabled requests run applyContextLadder once over hydrated session blocks and record mode/active/archived counts.
  - Knowledge, working-memory, and tool-registry injections select only active ladder blocks.
  - Omitted/non-true contextLadder keeps ordinary BlockStore queries and output unchanged.
  - A ladder exception is recorded as context_ladder_error and assembly falls back to the ordinary path.
  - Agent-driven live corpus evidence is generated from real current-session source files and never claims human traffic.
touchedAreas:
  - openclaw_runtime/src/context-engine/assembler.ts
  - openclaw_runtime/src/context-engine/assembler.test.ts
  - openclaw_runtime/scripts/context-ladder-live-corpus.mts
  - harness/specs/fixtures/context-ladder-live-corpus/**
  - shared/dcs/prod-flags-catalog.ts
  - docs/generated/catalogs/prod-flags.md
  - docs/generated/catalogs/tools.md
  - harness/specs/tasks/context-ladder-assembler-wiring.md
docs:
  required: false
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-ladder-assembler-wiring.md
  - pnpm harness validate --spec harness/specs/tasks/context-ladder-assembler-wiring.md
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.unit.config.ts src/context-engine/assembler.test.ts src/context-engine/block-lifecycle.test.ts src/context-engine/token-pressure.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec tsx scripts/context-ladder-live-corpus.mts
  - pnpm run catalogs:check
  - pnpm exec eslint openclaw_runtime/src/context-engine/assembler.ts openclaw_runtime/src/context-engine/assembler.test.ts openclaw_runtime/scripts/context-ladder-live-corpus.mts shared/dcs/prod-flags-catalog.ts
  - pnpm run typecheck
acceptance:
  - The assembler calls applyContextLadder with the caller-provided explicit tokenBudget.
  - Enabled ladder requests use only active blocks for DCS injections and record context_ladder metadata.
  - Omitted/non-true contextLadder keeps the ordinary two-channel path unchanged.
  - A ladder failure records context_ladder_error and falls back to the ordinary path without throwing.
  - Agent-driven live corpus evidence is on disk with reproduceCommand, driven_by=agent, actor=codex, and >=64K raw source chars.
  - runtime defaults remain unchanged; autoAppliedAssemblerFlip stays false and no real-human traffic is claimed.
notes:
  - L4 embedding remains deferred.
  - The live corpus uses current-session source/test files, not the synthetic 64K fixture.
---
