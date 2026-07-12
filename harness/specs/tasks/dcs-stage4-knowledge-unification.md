---
id: dcs-stage4-knowledge-unification
title: DCS Stage 4 knowledge Block unification (compass + role-memory)
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement the DCS v1.6 Stage 4 knowledge Block unification — compass-handler wraps buildPreReplyInjection (main session), role-memory-handler wraps buildContextPack (subagent session), and Assembler #appendKnowledge injects the unified knowledge Block — only after the stated readiness gates prove that Stage 1, Stage 2, Stage 3, and the retained Runtime build baseline are accepted.
touchedAreas:
  - harness/specs/tasks/dcs-stage4-knowledge-unification.md
  - harness/specs/rules/dcs-stage4-knowledge-unification-boundary.md
  - team/dcs/dcs-v1.6-spec.md
  - team/dcs/dcs-v1.6.1-addendum.md
  - openclaw_runtime/src/context-engine/block.ts
  - openclaw_runtime/src/context-engine/assembler.ts
  - openclaw_runtime/src/context-engine/assembler.test.ts
  - openclaw_runtime/src/context-engine/handlers/compass-handler.ts
  - openclaw_runtime/src/context-engine/handlers/compass-handler.test.ts
  - openclaw_runtime/src/context-engine/handlers/role-memory-handler.ts
  - openclaw_runtime/src/context-engine/handlers/role-memory-handler.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.knowledge.test.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/runtime-context-block-working-memory.test.ts
  - openclaw_runtime/src/config/runtime-context-block-tool-registry.test.ts
  - openclaw_runtime/src/config/runtime-context-block-compass.test.ts
  - openclaw_runtime/src/config/runtime-context-block-role-memory.test.ts
  - openclaw_runtime/src/sessions/session-key-utils.ts
  - package.json
  - team/dcs/README.md
expectedUserBehavior:
  - When compass flag is on and session is main, the assembler produces a knowledge Block from buildPreReplyInjection output and injects ## Knowledge into the context
  - When role_memory flag is on and session is subagent, the assembler produces a knowledge Block from buildContextPack output and injects ## Knowledge into the context
  - When both flags are off, the assembler is an identity pass-through (no Block production, no injection)
  - ANTI-3: subagent sessions never receive compass knowledge Blocks; main sessions never receive role-memory knowledge Blocks
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - contract-first-boundary
  - comms-regression
  - docs-sync
  - dcs-stage4-knowledge-unification-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/dcs-stage4-knowledge-unification.md
  - pnpm harness validate --spec harness/specs/tasks/dcs-stage4-knowledge-unification.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/assembler.test.ts src/context-engine/handlers/compass-handler.test.ts src/context-engine/handlers/role-memory-handler.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.runtime-config.config.ts src/config/runtime-context-block-working-memory.test.ts src/config/runtime-context-block-tool-registry.test.ts src/config/runtime-context-block-compass.test.ts src/config/runtime-context-block-role-memory.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/embedded-agent-runner/extensions.knowledge.test.ts
  - pnpm run typecheck
  - pnpm run lint:dcs
  - pnpm run test:dcs
  - pnpm run harness:ci
  - pnpm harness run --spec harness/specs/tasks/dcs-stage4-knowledge-unification.md --since 167065ee6 --dry-run
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm --dir openclaw_runtime build
  - git diff --check
acceptance:
  - readiness-gate: Stage 1 + Stage 2 + Stage 3 COMPLETE reports accepted; Runtime build baseline green
  - preflight: identify canonical producer (assembler after buildCompass/buildRoleMemory) and injection path (#appendKnowledge)
  - red-tests: tests written before implementation demonstrate missing behavior
  - compass-handler wraps buildPreReplyInjection output (PreReplyInjection → knowledge Block, source_system="compass"); legacy builder NOT modified
  - role-memory-handler wraps buildContextPack output (ContextPack → knowledge Block, source_system="role-memory"); legacy builder NOT modified
  - knowledge Block presence: always_on=false, on_demand.expand_tool="context_search", background=true, mutability="system_managed"
  - Assembler #appendKnowledge follows flag-guard + exactly-once + session-type-aware query pattern (compass for main, role-memory for subagent)
  - ANTI-3: subagent sessions never query compass Blocks; main sessions never query role-memory Blocks
  - addendum-2: ## Knowledge heading appears 0 or 1 times per LLM call
  - addendum-4: isMainSessionKey accepts optional mainKey param; selectHandlers passes through config-aware mainKey
  - addendum-5: no third role-memory injection channel (only #appendKnowledge)
  - addendum-6: combined character budget declared
  - no-forbidden-changes: no transport/host-api/db-table/COMPASS-write-path/experience/environment changes
  - flag-defaults-false: compass and role-memory flags default false
  - honest-report: distinguish DCS Block unification correctness from uplift claims
docs:
  required: true
  files:
    - team/dcs/README.md
---

# DCS Stage 4: knowledge Block unification

## Naming

- **compass-handler**: `context-engine/handlers/compass-handler.ts` — wraps `buildPreReplyInjection` output into a `knowledge` Block with `source_system="compass"`.
- **role-memory-handler**: `context-engine/handlers/role-memory-handler.ts` — wraps `buildContextPack` output into a `knowledge` Block with `source_system="role-memory"`.
- **#appendKnowledge**: Assembler private method that queries the BlockStore for `knowledge` Blocks (session-type-aware) and injects `## Knowledge` into the output.

## Design Authority and Reading Order

1. `team/dcs/dcs-v1.6-spec.md` §Stage 4 (L942-953) — deliverables and acceptance.
2. `team/dcs/dcs-v1.6-spec.md` knowledge Block two paths (L483-505) — compass (main) + role-memory (subagent).
3. `team/dcs/dcs-v1.6-spec.md` knowledge Block admission (L346-359) — compass requires verificationStatus/confidence/AUDN; role-memory uses structural validation.
4. `team/dcs/dcs-v1.6.1-addendum.md` addendum 2 (exactly-once), addendum 4 (config-aware mainKey), addendum 5 (no third channel), addendum 6 (char budget).

## Hard Readiness Gate

| Prerequisite | Evidence |
|-------------|----------|
| DCS Stage 1 final COMPLETE | `team/dcs/DCS-ROUND1-COMPLETE.md` |
| DCS Stage 2 final COMPLETE | `team/dcs/DCS-ROUND3-COMPLETE.md` |
| DCS Stage 3 final COMPLETE | `team/dcs/DCS-ROUND4-COMPLETE.md` |
| Runtime build baseline green | `pnpm --dir openclaw_runtime build` exit 0 |

## Data and Ownership Contract

### knowledge Block (compass path, main session)

| Field | Value |
|-------|-------|
| block_type | `"knowledge"` |
| source_system | `"compass"` |
| presence.always_on | `false` |
| presence.on_demand.expand_tool | `"context_search"` |
| presence.background | `true` |
| mutability | `"system_managed"` |
| compression_depth | `0` |
| full_content | `PreReplyInjection.sspString` + `PreReplyInjection.top5FactsString` |

### knowledge Block (role-memory path, subagent session)

| Field | Value |
|-------|-------|
| block_type | `"knowledge"` |
| source_system | `"role-memory"` |
| presence.always_on | `false` |
| presence.on_demand.expand_tool | `"context_search"` |
| presence.background | `true` |
| mutability | `"system_managed"` |
| compression_depth | `0` |
| full_content | serialized `ContextPack.buckets` |

## Mandatory Negative Tests

1. **ANTI-3**: subagent session with compass flag on → no compass Block queried, no compass injection.
2. **ANTI-3**: main session with role_memory flag on → no role-memory Block queried, no role-memory injection.
3. **Addendum 2**: `## Knowledge` heading appears at most once per LLM call.
4. **Addendum 5**: no third injection channel — only `#appendKnowledge` injects knowledge.
5. **v1.0 L408**: a session never has both compass and role-memory `always_on` knowledge Blocks (enforced by `selectHandlers`).
6. **No chain compression**: `compression_depth` is always `0` for freshly produced knowledge Blocks.

## Completion Sequence

1. RED: write handler tests, assembler tests, config tests — all fail.
2. GREEN: implement handlers, assembler #appendKnowledge, config schema.
3. Gates: typecheck, lint:dcs, test:dcs, harness validate/run, contract:check, comms, build, git diff --check.
4. Adversarial review: independent subagent scans for Critical/Important issues.
5. COMPLETE report: `team/dcs/DCS-ROUND5-COMPLETE.md`.
6. Update `team/dcs/README.md` with R5 section.
7. Commit on main.
