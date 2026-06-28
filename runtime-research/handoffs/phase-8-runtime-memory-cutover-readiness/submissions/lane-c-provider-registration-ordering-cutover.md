# Phase 8 Lane C: Provider Registration Ordering Cutover

## Scope Confirmation

- Lane: lane-c-provider-registration-ordering-cutover
- Output file: runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-c-provider-registration-ordering-cutover.md
- Files reviewed: runtime-research/handoffs/phase-7-runtime-memory-provider/synthesis.md; runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/README.md; runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/parallel-lanes.md; harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md; openclaw_runtime/src/context-engine/provider-registry.ts; openclaw_runtime/src/context-engine/memory-context-provider.ts; openclaw_runtime/src/runtime-core/memory-context.ts; tests/unit/runtime-memory-context-provider.test.ts; tests/unit/context-provider-registry.test.ts
- Files changed: runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-c-provider-registration-ordering-cutover.md
- Runtime behavior changed: no
- Main/Gateway/host-api/api-client paths changed: no

## Executive Summary

Lane C accepts optional RuntimeMemoryProvider registration readiness only. The current default registry order is unchanged: legacy context engine, then loop context pack. Runtime memory appears only when a caller explicitly passes an extra provider, and the provider itself is default-off, shadow-only, readonly, and gated by runtime.memory.provider. Provider-ordering cutover remains blocked because no default registration or ordering change was made.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Default provider registry does not include RuntimeMemoryProvider | file/test | openclaw_runtime/src/context-engine/provider-registry.ts; tests/unit/runtime-memory-context-provider.test.ts | provider-registry.ts:252-258; test lines 32-45 | createContextProviderRegistryPilot() creates legacy + loop providers only. |
| RuntimeMemoryProvider can be optional extra provider only | file/test | openclaw_runtime/src/context-engine/provider-registry.ts; tests/unit/runtime-memory-context-provider.test.ts | provider-registry.ts:253, 258; test lines 34-45 | Extra providers are appended only when passed. |
| RuntimeMemoryProvider manifest is default-off and shadow-only | file/test | openclaw_runtime/src/context-engine/memory-context-provider.ts; tests/unit/runtime-memory-context-provider.test.ts | memory-context-provider.ts:59-67; test lines 46-55 | Manifest has enabledByDefault false and shadowOnly true. |
| Disabled provider returns skipped diagnostic and marks legacy behavior unaffected | file/test | openclaw_runtime/src/context-engine/memory-context-provider.ts; tests/unit/runtime-memory-context-provider.test.ts | memory-context-provider.ts:98-117; test lines 66-95 | Required flag is runtime.memory.provider. |
| Memory provider has no completion/verifier/security/retry/tool/runtime authority | file/test | openclaw_runtime/src/context-engine/memory-context-provider.ts; tests/unit/runtime-memory-context-provider.test.ts | memory-context-provider.ts:77-84, 145-167, 353-361; test lines 285-315 | Output metadata is readonly/no-authority. |
| Renderer boundary is unchanged | scan | rtk rg renderer IPC/Gateway bypass scan over src/pages src/components | no matches | No renderer direct IPC/Gateway/WebSocket bypass added. |
| Main/Gateway/host-api/api-client were not changed by this lane | file list | this submission only | n/a | Comms replay/compare not required. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Flag-off parity | memory-context-provider.ts:98-117; runtime-memory-context-provider.test.ts:66-95 | pass | Provider flag disabled returns skipped diagnostic and legacyBehaviorUnaffected. |
| Raw chat/raw trace rejection | runtime-memory-context-contracts.test.ts:239-256 | pass | Provider consumes queryable facts, not raw inputs. |
| No raw retention | raw-retention scan over memory code/tests | pass | Production matches are sanitizer denylist/rejection classifier; provider file has no raw-retention matches. |
| No service/exporter/database/listener | focused service/exporter scan over memory production files | pass | No matches in memory provider or registry evidence files. |
| Source episode/evidence refs | memory-context-provider.ts:350-355, 387-394 | pass | Provider context metadata links source episodes/evidence refs. |
| Durable promotion gate | memory-context.ts:570-583 | pass | Provider cannot turn candidates into durable facts. |
| Current-valid query exclusion | runtime-memory-context-provider.test.ts:212-241; runtime-memory-store.test.ts:239-329 | pass | Candidate facts appear only when explicitly requested. |
| Rollback proof | omit extra provider or leave runtime.memory.provider false | pass | Default registry remains legacy + loop. |
| Comms replay/compare if required | changed files list | not applicable | No transport or comms paths changed. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | Provider manifest enabledByDefault false at memory-context-provider.ts:65. |
| No raw chat-log/raw trace memory | pass | Provider emits summaries from sanitized facts; raw rejection remains in memory-context.ts. |
| No unverified durable facts | pass | Provider reads queryable facts; durable guard remains memory-context.ts:570-583. |
| No persistence without rollback proof | not applicable | Lane C does not touch persistence. |
| No provider-ordering cutover without parity proof | pass | Default registry order is tested at runtime-memory-context-provider.test.ts:32-45. |
| No runtime authority | pass | no-authority metadata at memory-context-provider.ts:77-84 and 353-361. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md | pass | Phase 8 context | none |
| rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md | pass | Phase 8 spec | none |
| rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md | pass | Phase 7 prerequisite | none |
| rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/context-provider-registry.test.ts | pass, 5 files / 31 tests | Provider optionality, default ordering, flag disabled behavior | none |
| rtk rg renderer IPC/Gateway bypass scan over src/pages src/components | pass/no matches | Renderer boundary | none |

## Design Conflicts

| Conflict | Evidence | Proposed Resolution |
|---|---|---|
| Optional registration is supported, but default provider ordering cutover is not accepted | provider-registry.ts:252-258 and runtime-memory-context-provider.test.ts:32-45 | Keep RuntimeMemoryProvider out of default registry until synthesis accepts explicit ordering/parity evidence. |
| Provider manifest has order 70, but that does not affect default order unless registered | memory-context-provider.ts:59; provider-registry.ts:252-258 | Treat order as experimental metadata only while registration remains explicit. |

## Status

```text
Status: accepted
```
