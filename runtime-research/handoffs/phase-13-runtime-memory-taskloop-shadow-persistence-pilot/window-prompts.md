# Phase 13 Window Prompts

Use these prompts in order. Lane B and Lane C can run in parallel after Lane A is accepted or clearly stable. Lane D can run in parallel if no provider/Gateway/config code has been touched.

## Execution Order

1. Lane A: TaskLoop call-site gate and disabled parity.
2. Lane B and Lane C: run in parallel after Lane A.
3. Lane D: run after A or in parallel with B/C when its surfaces are stable.
4. Lane E: run after A-D submissions exist.
5. Synthesis owner: run after Lane E.

## Lane A Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 13 Lane A: TaskLoop call-site gate and disabled parity.

Goal:
Define or implement the minimal default-off TaskLoop Runtime Memory call-site pilot for sanitized episode writes. The pilot must require both runtime.memory.shadow and runtime.memory.persist before adapter writes can run. Do not add TaskLoop memory reads, Gateway/Electron/renderer/shared host contract cutover, provider registration/order changes, durable fact writes, default-on behavior, raw retention, service/exporter/listener work, or memory-derived runtime authority.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md.
- Read openclaw_runtime/AGENTS.md.
- Read runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/synthesis.md.
- Read runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md.
- Read runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md.
- Read runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md.
- Read runtime-research/agent-runtime-index.md.
- Read harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md.
- Read Phase 13 README, parallel-lanes, and submission-template.
- Read openclaw_runtime/src/agents/task-loop-controller.ts.
- Read openclaw_runtime/src/runtime-core/memory-runtime-integration.ts and memory-persistence.ts.
- Read tests/unit/task-loop-controller.test.ts and focused Runtime Memory tests.

Implementation boundary:
- Preferred touched runtime file, if code is needed: openclaw_runtime/src/agents/task-loop-controller.ts.
- Preferred tests: tests/unit/task-loop-controller.test.ts plus focused runtime memory tests.
- Adapter writes must be skipped unless runtime.memory.shadow === true and runtime.memory.persist === true.
- Omitted flags, shadow=false, persist=false, and persist=true with shadow=false must not instantiate/open/read/write SQLite.
- Disabled paths must preserve TaskLoop terminal status, result payload shape, approvals, retries, error mapping, verifier/security behavior, event-log/checkpoint/resume behavior, and provider ordering.
- Any adapter import must be isolated to the intended TaskLoop pilot and tests.

Evidence required:
- Prove Phase 12 accepted planning/spec/evidence only.
- Prove Phase 11 adapter remains isolated except for the intended Phase 13 TaskLoop pilot.
- Prove dual-flag disabled parity with a throwing opener or equivalent.
- Prove no Gateway/Electron/renderer/shared/provider-registry/default-barrel imports.
- Prove no raw retention, no service/exporter/listener, and no memory runtime authority.

Validation:
- C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs context --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md
- C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md
- Focused task-loop-controller and Runtime Memory tests.
- Node typecheck if code changed.
- Intended TaskLoop import scan.
- Forbidden authority import scan.
- Raw-retention and service/exporter/listener scans.
- Comms replay/compare only if Main/Gateway/host-api/api-client/provider transport paths changed.

Write:
runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-a-taskloop-callsite-gate-disabled-parity.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked.
```

## Lane B Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 13 Lane B: sanitized episode write mapping.

Goal:
Define or implement the bounded TaskLoop lifecycle metadata mapping to Runtime Memory episode records. Persist only sanitized episodes. Do not persist facts, candidates, invalidations, provider context, prompts, transcripts, full payloads, full checkpoints, tool args/output, env, secrets, stdout/stderr, or raw trace context.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md.
- Read openclaw_runtime/AGENTS.md.
- Read Phase 13 spec/README/parallel-lanes/submission-template.
- Read Phase 12, Phase 11, Phase 10, and Phase 9 syntheses.
- Read Lane A submission if it exists.
- Read memory-context.ts, memory-store.ts, memory-persistence.ts, memory-runtime-integration.ts, task-loop-controller.ts, and focused tests.

Implementation boundary:
- Episode records must use existing Runtime Memory sanitizers and bounded record shapes.
- TaskLoop mapping must not inspect or retain raw prompts, transcripts, full tool args/output, full checkpoints, env, secrets, or raw trace context.
- Facts, candidates, and invalidations are out of scope for Phase 13.
- Durable promotion gates must remain unchanged.

Evidence required:
- Sanitized episode-only writes.
- Raw retention rejection/redaction and persistence non-leak proof.
- Idempotency key handoff to Lane C or direct evidence if touched.
- Current-valid query and durable fact behavior unchanged.
- No runtime authority or service/exporter/listener additions.

Validation:
- Phase 13 harness validate.
- Focused runtime-memory-context-contracts, runtime-memory-store, runtime-memory-persistence, runtime-memory-runtime-integration, and task-loop-controller tests.
- Node typecheck if code changed.
- Raw-retention scan over touched files.
- Service/exporter/listener scan.
- Forbidden authority import scan.

Write:
runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-b-sanitized-episode-write-mapping.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked.
```

## Lane C Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 13 Lane C: idempotency, error isolation, and rollback.

Goal:
Prove TaskLoop shadow memory writes are idempotent, bounded, rollback-safe, and error-isolated. Adapter failures must not change TaskLoop status, result payloads, retries, approvals, tool policy, verifier/security behavior, event-log/checkpoint/resume behavior, or provider ordering.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md.
- Read openclaw_runtime/AGENTS.md.
- Read Phase 13 spec/README/parallel-lanes/submission-template.
- Read Phase 12, Phase 11, Phase 10, and Phase 9 syntheses.
- Read Lane A and B submissions if they exist.
- Read task-loop-controller.ts, memory-runtime-integration.ts, memory-persistence.ts, and focused tests.

Implementation boundary:
- Stable idempotency keys must prevent duplicate episode rows for the same TaskLoop event.
- Adapter write errors are diagnostics only. They must not throw through legacy TaskLoop behavior unless the legacy path already throws without memory.
- Rollback is disabling either runtime.memory.shadow or runtime.memory.persist, or omitting the TaskLoop import/call site.
- Existing Phase 9 rows must be preserved. Do not add deletion, doctor migration, or cleanup policy in Phase 13.

Evidence required:
- Idempotency tests.
- Error injection tests.
- Disabled parity tests.
- TaskLoop result/status/retry/approval/verifier/security/event-log/checkpoint parity tests.
- Rollback proof and no row deletion proof.

Validation:
- Phase 13 harness validate.
- Focused task-loop-controller, runtime-memory-persistence, and runtime-memory-runtime-integration tests.
- Node typecheck if code changed.
- Persistence scan.
- Raw-retention and service/exporter/listener scans.

Write:
runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-c-idempotency-error-isolation-rollback.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked.
```

## Lane D Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 13 Lane D: provider, Gateway, docs, and no-authority boundary.

Goal:
Prove Phase 13 has no Gateway/Electron/renderer/shared host contract cutover, no provider default registration, no provider ordering change, and no memory-derived runtime authority. Update config/docs only if the pilot changes operator-visible semantics.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md.
- Read openclaw_runtime/AGENTS.md.
- Read Phase 13 spec/README/parallel-lanes/submission-template.
- Read Phase 12, Phase 11, Phase 10, and Phase 9 syntheses.
- Read provider-registry.ts, memory-context-provider.ts, config types/help/labels/schema, README.md, README.zh-CN.md, README.ja-JP.md if behavior/docs changed, and focused tests.

Implementation boundary:
- Default provider order remains legacy context engine -> loop context pack -> explicit extras.
- runtime.memory.provider remains separate and default false.
- runtime.memory.persist and runtime.memory.shadow do not enable provider output.
- No Gateway/Electron/renderer/shared host API route is added in Phase 13.
- Config/help wording, if touched, must say the pilot is default-off, dual-flag gated, sanitized episode-only, non-user-facing unless separately accepted, and non-authoritative.

Evidence required:
- Provider ordering tests/scans.
- Renderer/Main boundary scan.
- Forbidden authority import scan.
- Config schema/help tests if config changed.
- Docs sync decision and README locale review if user-visible behavior changed.
- No raw retention/service/exporter/listener/runtime authority proof.

Validation:
- Phase 13 harness validate.
- context-provider-registry, runtime-memory-context-provider, runtime-feature-config-schema tests if relevant.
- Node typecheck if code changed.
- Renderer boundary scan.
- Forbidden authority import scan.
- Raw-retention and service/exporter/listener scans.
- Comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths changed.

Write:
runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-d-provider-gateway-docs-no-authority-boundary.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked.
```

## Lane E Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 13 Lane E: validation, scans, comms, and synthesis readiness.

Prerequisite:
Only continue if Lane A-D submissions all exist. If any are missing, stop and report the missing submissions.

Goal:
Validate Phase 13 evidence and prepare synthesis. Re-verify claims; do not accept unproven lane text.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md.
- Read openclaw_runtime/AGENTS.md.
- Read Phase 13 spec/README/parallel-lanes/submission-template.
- Read Phase 12, Phase 11, Phase 10, and Phase 9 syntheses.
- Read all Phase 13 Lane A-D submissions.
- Read relevant runtime memory and TaskLoop source/tests touched by A-D.

Required checks:
- Confirm A-D each has exactly one valid Status line.
- Reclassify A-D as accepted / needs_revision / blocked.
- Run Phase 13 context/validate and Phase 12/11/10/9 validate.
- Run focused Runtime Memory and TaskLoop tests, node typecheck, renderer boundary scan, intended TaskLoop import scan, forbidden authority import scan, raw-retention scan, service/exporter/database-service/listener scan, and persistence scan.
- Run comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths changed or if the ambient worktree has dirty communication-adjacent paths.
- Review docs sync requirements.

Write:
runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-e-validation-scans-comms-synthesis-readiness.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked.
```

## Synthesis Owner Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 13 synthesis owner: runtime memory TaskLoop shadow persistence pilot synthesis.

Prerequisite:
Only continue if Lane A-E submissions all exist. If any are missing, stop and report the missing submissions.

Goal:
Synthesize Phase 13 Lane A-E evidence. Re-verify evidence; do not accept unproven claims.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md.
- Read openclaw_runtime/AGENTS.md.
- Read harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md.
- Read runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/README.md.
- Read runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/parallel-lanes.md.
- Read all Phase 13 Lane A-E submissions.
- Read Phase 12, Phase 11, Phase 10, and Phase 9 syntheses.
- Read runtime-research/agent-runtime-index.md.
- Read relevant runtime memory and TaskLoop source/tests.

Tasks:
1. Confirm A-E each has exactly one Status line.
2. Reclassify A-E: accepted / needs_revision / blocked.
3. Run Phase 13 context/validate and Phase 12/11/10/9 validate.
4. Run focused Runtime Memory and TaskLoop tests, node typecheck, renderer boundary scan, intended TaskLoop import scan, forbidden authority import scan, raw-retention scan, service/exporter/database-service/listener scan, and persistence scan.
5. Run comms replay/compare if Main/Gateway/host-api/api-client/provider transport paths changed or if the ambient worktree has dirty communication-adjacent paths.
6. Write runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/synthesis.md.
7. If synthesis is accepted, update runtime-research/agent-runtime-index.md.

Must preserve boundaries:
- May accept only a default-off TaskLoop shadow persistence pilot for sanitized episode records.
- Must require both runtime.memory.shadow and runtime.memory.persist before adapter writes run.
- Must not accept TaskLoop memory reads.
- Must not accept Gateway/Electron/renderer/shared host contract cutover.
- Must not accept provider ordering cutover or default provider registration.
- Must not accept default-on persistence.
- Must not accept raw retention.
- Must not accept unverified durable facts, automatic extraction, or fact promotion.
- Must not accept service/exporter/database-service/listener work.
- Must not accept memory runtime authority.

Final conclusion must contain exactly one:
Status: accepted / needs_revision / blocked
```
