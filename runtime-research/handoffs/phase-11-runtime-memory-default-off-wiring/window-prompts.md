# Phase 11 Window Prompts

Use these prompts in order. Lane B, C, and D can run in parallel after Lane A is accepted or clearly stable.

## Execution Order

1. Lane A: adapter contract and flag-off parity.
2. Lane B, C, D: run in parallel after Lane A.
3. Lane E: run after A-D submissions exist.
4. Synthesis owner: run after Lane E.

## Lane A Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 11 Lane A: adapter contract and flag-off parity.

Goal:
Define or implement the isolated default-off Runtime Memory runtime integration adapter. This lane is allowed to add a small adapter and focused tests only if it proves disabled parity. Do not wire it into TaskLoop, Gateway, Electron Main, renderer, shared host contracts, default provider registry, verifier, security policy, retry policy, tool permission policy, provider ordering, or runtime authority paths.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md.
- Read openclaw_runtime/AGENTS.md.
- Read runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md.
- Read runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md.
- Read runtime-research/agent-runtime-index.md.
- Read harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md.
- Read harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md.
- Read openclaw_runtime/src/runtime-core/memory-persistence.ts and focused persistence tests.

Implementation boundary:
- Preferred target file if code is needed: openclaw_runtime/src/runtime-core/memory-runtime-integration.ts.
- Preferred test file if code is needed: tests/unit/runtime-memory-runtime-integration.test.ts.
- The adapter may expose explicit methods such as appendEpisode, appendFact, invalidateFact, and loadStore.
- The adapter must check runtime.memory.persist before SQLite open/read/write.
- The adapter must not inspect raw TaskLoop payloads, transcripts, prompts, tool args/output, env, secrets, raw trace context, or raw checkpoint payloads.
- The adapter must not import TaskLoop/Gateway/Electron/renderer/shared code.

Evidence required:
- Prove Phase 10 synthesis accepted only boundary/readiness.
- Prove Phase 9 accepted only default-off local sanitized persistence foundation.
- Prove runtime.memory.persist=false causes no SQLite open/read/write using a throwing opener or equivalent.
- Prove no imports from TaskLoop/Gateway/Electron/renderer/shared/default provider registry.
- Prove no service/exporter/database-service/listener and no raw retention.

Validation:
- C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs context --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md
- C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md
- Focused runtime memory persistence/integration tests.
- Node typecheck if code changed.
- Runtime authority import scan.
- Raw-retention and service/exporter/listener scans.
- Comms replay/compare only if Main/Gateway/host-api/api-client/provider transport paths changed.

Write:
runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/submissions/lane-a-adapter-contract-flag-off-parity.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked.
```

## Lane B Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 11 Lane B: sanitized write boundary.

Goal:
Implement or prove the adapter write boundary for sanitized Runtime Memory episode/fact/candidate/invalidation records. Do not implement automatic extraction from TaskLoop/Gateway, raw transcripts, prompts, checkpoints, or tool payloads. Do not promote candidates or LLM proposals to durable facts.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md.
- Read openclaw_runtime/AGENTS.md.
- Read Phase 11 spec/README/parallel-lanes/submission-template.
- Read Phase 10 synthesis and Lane A submission.
- Read Phase 9 synthesis.
- Read memory-context.ts, memory-store.ts, memory-persistence.ts, and focused tests.

Implementation boundary:
- Use existing Runtime Memory sanitizers and type guards.
- If adding builder helpers, they must return rejected results for raw chat/transcript/trace/prompt/payload/checkpoint/tool/env/secret/raw trace context markers.
- Durable facts must require accepted verification status, acceptedAt, source episode refs, evidence refs, and promotion evidence.
- Candidates must remain candidates and must not gain promotion_json/acceptedAt.

Evidence required:
- Flag-off no-write parity remains true.
- Write methods accept only sanitized bounded records.
- Raw retention is rejected/redacted and not persisted.
- Current-valid query behavior remains unchanged.
- Durable promotion gate remains verifier/human/deterministic-rule only.
- No runtime authority or service/exporter/listener additions.

Validation:
- Phase 11 harness validate.
- Focused runtime-memory-context-contracts, runtime-memory-store, runtime-memory-persistence, and runtime-memory-runtime-integration tests.
- Node typecheck if code changed.
- Raw-retention scan over touched files and production persistence/integration files.
- Service/exporter/listener scan.
- Runtime authority import scan.

Write:
runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/submissions/lane-b-sanitized-write-boundary.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked.
```

## Lane C Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 11 Lane C: read hydration and explicit provider boundary.

Goal:
Implement or prove read hydration from persisted sanitized rows into RuntimeMemoryStore only, and define optional provider hydration through explicit extra-provider injection only. Do not change default provider ordering. Do not make runtime.memory.persist enable provider output.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md.
- Read openclaw_runtime/AGENTS.md.
- Read Phase 11 spec/README/parallel-lanes/submission-template.
- Read Phase 10 synthesis and Lane A submission.
- Read Phase 9 synthesis.
- Read memory-persistence.ts, memory-store.ts, memory-context-provider.ts, provider-registry.ts, and focused tests.

Implementation boundary:
- Read hydration must call the Phase 9 persistence owner and return a RuntimeMemoryStore snapshot or explicit skipped result.
- Disabled persist must not open/read SQLite.
- Provider hydration, if implemented, must be explicit: createRuntimeMemoryContextProvider({ queryFacts: (query) => loaded.store.queryFacts(query) }) and createContextProviderRegistryPilot([memoryProvider]).
- Default registry must remain legacy-context-engine -> loop-context-pack -> explicit extras.
- runtime.memory.provider remains a separate required flag for provider output.
- Provider output remains readonly, budgeted, shadow/no-authority.

Evidence required:
- Provider ordering tests.
- RuntimeMemoryProvider disabled/default-off tests.
- Current-valid query exclusions.
- No raw row or raw JSON prompt dump exposure.
- No TaskLoop/Gateway/provider-ordering cutover.

Validation:
- Phase 11 harness validate.
- runtime-memory-context-provider, runtime-memory-store, runtime-memory-persistence, runtime-memory-runtime-integration, and context-provider-registry tests.
- Node typecheck if code changed.
- Provider ordering scan.
- Runtime authority import scan.
- Raw-retention and service/exporter/listener scans.

Write:
runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/submissions/lane-c-read-hydration-provider-boundary.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked.
```

## Lane D Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 11 Lane D: config docs rollback boundary.

Goal:
Clean up stale config/help wording and prove rollback/docs boundaries for Phase 11. Do not imply runtime persistence is default-on or user-facing. Do not change runtime behavior unless required by config schema/help tests.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md.
- Read openclaw_runtime/AGENTS.md.
- Read Phase 11 spec/README/parallel-lanes/submission-template.
- Read Phase 10 synthesis and Phase 9 synthesis.
- Read openclaw_runtime/src/config/types.openclaw.ts, schema.help.ts, schema.labels.ts, zod-schema.ts, and runtime-feature-config-schema tests.
- Review README.md, README.zh-CN.md, README.ja-JP.md, README.ru-RU.md only if behavior/operator-facing docs changed.

Implementation boundary:
- Update runtime.memory.persist wording so it no longer says Phase 9 persistence is unimplemented.
- Preserve the warning that runtime memory remains default-off and does not enable TaskLoop/Gateway/provider/default-on cutover, fact promotion, provider output, or runtime authority.
- Do not add new config flags unless the lane proves existing flags cannot cover the behavior.
- Rollback remains disable flags / omit adapter / omit explicit provider, preserving existing rows.

Evidence required:
- Config help/schema tests pass if touched.
- Docs sync decision documented.
- No default true config.
- No raw retention/service/exporter/listener/runtime authority changes.

Validation:
- Phase 11 harness validate.
- runtime-feature-config-schema tests if config files changed.
- Node typecheck.
- Raw-retention/service scans over touched config/docs if applicable.
- git diff --check for docs/config-only changes.

Write:
runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/submissions/lane-d-config-docs-rollback-boundary.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked.
```

## Lane E Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 11 Lane E: validation and synthesis readiness.

Prerequisite:
Only continue if Lane A-D submissions all exist. If any are missing, stop and report the missing submissions.

Goal:
Validate Phase 11 evidence and prepare synthesis. Re-verify claims; do not accept unproven lane text.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md.
- Read openclaw_runtime/AGENTS.md.
- Read Phase 11 spec/README/parallel-lanes/submission-template.
- Read Phase 10 synthesis and Phase 9 synthesis.
- Read all Phase 11 Lane A-D submissions.
- Read relevant runtime memory source/tests touched by A-D.

Required checks:
- Confirm A-D each has exactly one valid Status line.
- Reclassify A-D as accepted / needs_revision / blocked.
- Run Phase 11/10/9 harness validate.
- Run focused runtime memory tests, integration tests if present, node typecheck, renderer boundary scan, runtime authority import scan, raw-retention scan, service/exporter/database-service/listener scan, and persistence scan.
- Run comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths changed.
- Review docs sync requirements.

Write:
runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/submissions/lane-e-validation-synthesis-readiness.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked.
```

## Synthesis Owner Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 11 synthesis owner: runtime memory default-off wiring MVP synthesis.

Prerequisite:
Only continue if Lane A-E submissions all exist. If any are missing, stop and report the missing submissions.

Goal:
Synthesize Phase 11 Lane A-E evidence. Re-verify evidence; do not accept unproven claims.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md.
- Read openclaw_runtime/AGENTS.md.
- Read harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md.
- Read runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/README.md.
- Read runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/parallel-lanes.md.
- Read all Phase 11 Lane A-E submissions.
- Read runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md.
- Read runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md.
- Read runtime-research/agent-runtime-index.md.
- Read relevant runtime memory source/tests.

Tasks:
1. Confirm A-E each has exactly one Status line.
2. Reclassify A-E: accepted / needs_revision / blocked.
3. Run Phase 11/10/9 harness validate.
4. Run focused runtime memory tests, node typecheck, renderer boundary scan, runtime authority import scan, raw-retention scan, service/exporter/database-service/listener scan, persistence scan.
5. Run comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths changed.
6. Write runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md.
7. If synthesis is accepted, update runtime-research/agent-runtime-index.md.

Must preserve boundaries:
- May accept only isolated default-off adapter wiring/readiness.
- Must not accept default-on persistence.
- Must not accept TaskLoop/Gateway/runtime cutover unless lane evidence proves it and the Phase 11 spec allows it; this spec does not allow that cutover.
- Must not accept provider ordering cutover.
- Must not accept raw retention.
- Must not accept unverified durable facts.
- Must not accept service/exporter/database-service/listener.
- Must not accept memory runtime authority.

Final conclusion must contain exactly one:
Status: accepted / needs_revision / blocked
```
