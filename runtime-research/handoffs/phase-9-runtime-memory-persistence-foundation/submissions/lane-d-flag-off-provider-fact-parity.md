# Phase 9 Lane D: Flag-Off Provider Fact Parity

## Scope Confirmation

- Lane: `lane-d-flag-off-provider-fact-parity`
- Output file: `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-d-flag-off-provider-fact-parity.md`
- Files reviewed:
  - `AGENTS.md`
  - `C:\Users\27933\.codex\RTK.md`
  - `openclaw_runtime/AGENTS.md`
  - `harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md`
  - `harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md`
  - `harness/specs/tasks/phase-7-runtime-memory-provider.md`
  - `harness/specs/scenarios/gateway-backend-communication.md`
  - `harness/specs/rules/renderer-main-boundary.md`
  - `harness/specs/rules/backend-communication-boundary.md`
  - `harness/specs/rules/api-client-transport-policy.md`
  - `harness/specs/rules/host-api-fallback-policy.md`
  - `harness/specs/rules/comms-regression.md`
  - `harness/specs/rules/docs-sync.md`
  - `harness/specs/layers/openclaw-runtime.md`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/README.md`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/parallel-lanes.md`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submission-template.md`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-a-persistence-spec-boundary.md`
  - `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/synthesis.md`
  - `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-f-config-flag-schema-parity.md`
  - `openclaw_runtime/src/runtime-core/memory-context.ts`
  - `openclaw_runtime/src/runtime-core/memory-store.ts`
  - `openclaw_runtime/src/runtime-core/memory-persistence.ts`
  - `openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts`
  - `openclaw_runtime/src/context-engine/memory-context-provider.ts`
  - `openclaw_runtime/src/context-engine/provider-registry.ts`
  - `tests/unit/runtime-memory-context-contracts.test.ts`
  - `tests/unit/runtime-memory-store.test.ts`
  - `tests/unit/runtime-memory-proposal-shadow.test.ts`
  - `tests/unit/runtime-memory-context-provider.test.ts`
  - `tests/unit/context-provider-registry.test.ts`
  - `tests/unit/runtime-memory-persistence.test.ts`
- Files changed:
  - `tests/unit/runtime-memory-persistence.test.ts`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-d-flag-off-provider-fact-parity.md`
- Runtime behavior changed: no
- Main/Gateway/host-api/api-client paths changed by Lane D: no

## Executive Summary

Lane D accepts the current flag-off provider/fact parity proof. The current workspace contains a default-off local SQLite persistence store in `memory-persistence.ts`; Lane D therefore proves it is inert when `runtime.memory.persist` is false instead of relying on older lane text that said no persistence implementation exists.

Default provider ordering remains `legacy-context-engine`, then `loop-context-pack`; `RuntimeMemoryProvider` is not default-registered and appears only when explicitly passed as an extra provider. Runtime memory context remains readonly, budgeted, shadow-only, and marked with no completion, verifier, security, retry, tool, or runtime authority. Durable facts still require non-empty source episode refs, evidence refs, accepted verification status, and promotion evidence from `verifier`, `human`, or `deterministic_rule`; candidates and verified-looking candidate records remain non-durable.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Runtime memory flags are strict default-off, including `provider` and `persist`. | file/test | `openclaw_runtime/src/runtime-core/memory-context.ts`; `tests/unit/runtime-feature-config-schema.test.ts` | `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS` at `memory-context.ts:129`; `persist: false` at `memory-context.ts:133`; strict flag resolution at `memory-context.ts:690` and `memory-context.ts:696-699` | Flags become true only when the exact config boolean is true. |
| `runtime.memory.persist=false` does not open, migrate, read, or write the local store. | file/test | `openclaw_runtime/src/runtime-core/memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | skip branches at `memory-persistence.ts:342-344`, `361-362`, `378-379`, `395-396`, `409-413`; `persistEnabled` at `memory-persistence.ts:441`; test at `runtime-memory-persistence.test.ts:31-64` | The test injects an `openDatabase` callback that would throw and asserts `openCalls` stays `0`. |
| Default provider ordering is unchanged and excludes runtime memory by default. | file/test | `openclaw_runtime/src/context-engine/provider-registry.ts`; `tests/unit/context-provider-registry.test.ts`; `tests/unit/runtime-memory-context-provider.test.ts` | registry construction at `provider-registry.ts:252-258`; default registry test at `context-provider-registry.test.ts:30-47`; optional memory registration test at `runtime-memory-context-provider.test.ts:32-45` | Default list is only legacy context engine, then loop context pack. |
| RuntimeMemoryProvider is optional, flag-gated, readonly, budgeted, and no-authority. | file/test | `openclaw_runtime/src/context-engine/memory-context-provider.ts`; `tests/unit/runtime-memory-context-provider.test.ts` | `enabledByDefault: false` and `shadowOnly: true` at `memory-context-provider.ts:65-66`; no-authority metadata at `memory-context-provider.ts:77-84`, `145-167`, `353-361`; disabled diagnostic at `memory-context-provider.ts:101-113`; budget handling at `memory-context-provider.ts:232-263`, `286-304`, `533` | Tests cover disabled fallback, budgeted summaries, readonly result, callback read path, and no runtime/tool authority. |
| Current-valid queries exclude invalidated, expired, rejected, candidate, and unpromoted facts by default. | file/test | `openclaw_runtime/src/runtime-core/memory-context.ts`; `openclaw_runtime/src/runtime-core/memory-store.ts`; focused tests | validity filters at `memory-context.ts:900-928`; verification filters at `memory-context.ts:1176-1194`; store invalidation application at `memory-store.ts:306-321`; tests at `runtime-memory-context-contracts.test.ts:340-435`, `runtime-memory-store.test.ts:294-343`, `runtime-memory-store.test.ts:349-439`, `runtime-memory-persistence.test.ts:189-207` | Explicit include flags/status requests are required to see excluded shapes. |
| Durable facts require source episode refs, evidence refs, accepted verification status, and promotion evidence. | file/test | `openclaw_runtime/src/runtime-core/memory-context.ts`; focused tests | source/evidence requirements at `memory-context.ts:563`, `memory-context.ts:583`; accepted statuses at `memory-context.ts:76-83`, `memory-context.ts:581`; promotion source/evidence at `memory-context.ts:178-180`, `memory-context.ts:528-538`; tests at `runtime-memory-context-contracts.test.ts:154-236` | `isRuntimeMemoryTemporalFact` rejects candidate status and missing promotion evidence. |
| Persistence does not turn candidates or verified-looking candidate records into durable facts. | file/test | `openclaw_runtime/src/runtime-core/memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | `factToRow` uses `record_kind` and nullable `promotion_json` at `memory-persistence.ts:758`; test at `runtime-memory-persistence.test.ts:147`, `runtime-memory-persistence.test.ts:221-246` | The persisted verified-looking candidate row remains `record_kind: "candidate"`, `promotion_json` null, no `promotion`, no `acceptedAt`, and has `proposedAt`. |
| Proposal shadow remains candidate-only and readonly. | file/test | `tests/unit/runtime-memory-proposal-shadow.test.ts` | candidate-only proof at `runtime-memory-proposal-shadow.test.ts:73-102`; accepted fact rejection at `runtime-memory-proposal-shadow.test.ts:105-131` | `acceptedFacts` stays empty; accepted fact inputs are rejected. |
| Renderer boundary has no direct IPC/Gateway/WebSocket bypass in scanned page/component paths. | scan | `rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components` | result: `NO_MATCHES` | Confirms Lane D added no renderer bypass. |
| Service/exporter/listener scan has no implementation matches. | scan | `rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\\(" ...` | result: only Phase 9 docs/submission forbidden-boundary text | No runtime memory source/test implementation match. |
| Raw-retention scan matches only sanitizer denylist, negative fixtures, and docs forbids/proof text. | scan | `rg -n "rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate" ...` | reviewed matches | Memory source matches are rejection/redaction classifiers; test matches assert raw output is rejected or absent. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Flag-off parity | `runtime-memory-persistence.test.ts:31-64`; `runtime-memory-context-provider.test.ts:66-96`; `context-provider-registry.test.ts:51-87` | pass | `persist=false` skips DB access; `provider=false` returns fallback; registry pilot flag-off preserves legacy messages/prompt. |
| Store owner and schema | `memory-persistence.ts:42-45`; schema SQL at `memory-persistence.ts:208`; migration meta at `memory-persistence.ts:457-473` | pass | Owner is `openclaw_runtime.runtime-core.memory-persistence`; schema is local SQLite tables under the shared OpenClaw state DB. |
| Migration and idempotency | `runtime-memory-persistence.test.ts:67-146`; episode duplicate/idempotency proof at `runtime-memory-persistence.test.ts:88-108` | pass | Migration is idempotent; duplicate episode/fact writes do not overwrite canonical truth. |
| Retention and redaction | `runtime-memory-persistence.test.ts:67-246`, `runtime-memory-persistence.test.ts:248-296`; `memory-persistence.ts:823-860` | pass | Sanitized writes reject raw output and trim with the same bounded store policy. |
| Raw chat/raw trace rejection | `memory-context.ts:99-108`, `memory-context.ts:346-391`; focused tests | pass | Raw strings and sensitive keys are rejected/redacted before store/persistence. |
| No raw retention | raw-retention scan; `runtime-memory-persistence.test.ts:233-246` | pass | Persisted DB text excludes `stdout dump` and `raw prompt`; verified-looking candidate has no promotion payload. |
| No service/exporter/database/listener | service/exporter scan | pass | Matches are only docs/submission forbidden text; no implementation service/listener/exporter added. |
| Source episode/evidence refs | `memory-context.ts:563`, `memory-context.ts:583`; `runtime-memory-context-contracts.test.ts:154-236` | pass | Fact and candidate guards require non-empty source episode refs and evidence refs. |
| Durable promotion gate | `memory-context.ts:528-538`, `memory-context.ts:570-583`; `runtime-memory-context-contracts.test.ts:229-236`; `runtime-memory-persistence.test.ts:239-246` | pass | Durable facts require accepted status plus verifier/human/deterministic-rule promotion evidence; persisted candidates remain candidates. |
| Current-valid query exclusion | `memory-context.ts:900-928`, `memory-context.ts:1176-1194`; `memory-store.ts:306-321`; focused tests | pass | Default queries exclude invalidated/expired/rejected/candidate/unpromoted facts; include flags/status filters are explicit. |
| Rollback proof | `memory-persistence.ts:342-344`, `361-362`, `378-379`, `395-396`, `409-413`; test at `runtime-memory-persistence.test.ts:31-64` | pass | Disabling `runtime.memory.persist` stops migration, reads, writes, and DB open calls while returning an empty in-memory store. |
| Comms replay/compare if required | `git status -sb`; touched files list | not applicable | Lane D did not change Main, Gateway, host-api, api-client, renderer transport, or provider transport paths. Existing unrelated dirty communication files were not touched by this lane. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS` keeps `shadow`, `provider`, `proposeFacts`, and `persist` false; provider manifest is `enabledByDefault: false`. |
| No raw chat-log/raw trace memory | pass | Raw-retention scan plus sanitizer/test evidence show raw values are rejected/redacted, not retained. |
| No unverified durable facts | pass | Durable type guard and persistence row checks keep candidates separate from durable facts. |
| No persistence without owner/schema/migration/rollback proof | pass | Current persistence has owner/schema/migration/idempotency tests and flag-off rollback proof; no default-on cutover is accepted. |
| No provider-ordering cutover without parity proof | pass | Default registry ordering remains legacy context engine then loop context pack; memory provider is extra-provider only. |
| No runtime authority | pass | Memory provider metadata and tests assert readonly/no completion/verifier/security/retry/tool/runtime authority; persistence store is not imported by TaskLoop/Gateway/tool policy paths in this lane. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| `rtk powershell ...` | failed | RTK availability check during required reading | `rtk` is not on this PowerShell PATH, so equivalent commands were run without RTK. |
| `pnpm harness context --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | failed before harness | Required naked pnpm attempt | Blocked by `ERR_PNPM_IGNORED_BUILDS`; rerun with `corepack pnpm`. |
| `pnpm harness validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | failed before harness | Required naked pnpm attempt | Same ignored-builds install gate. |
| `pnpm harness validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md` | failed before harness | Required naked pnpm attempt | Same ignored-builds install gate; one run also emitted `.bin` creation warnings during pnpm install probing. |
| `corepack pnpm harness context --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 selected reading list | none |
| `corepack pnpm harness validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 task spec | none |
| `corepack pnpm harness validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md` | pass | Phase 8 prerequisite task spec | none |
| `corepack pnpm harness validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass | Phase 7 prerequisite task spec from Phase 9 requiredTests | none |
| `corepack pnpm test tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/context-provider-registry.test.ts` | pass, 6 files / 36 tests | Persistence flag-off, provider/registry parity, fact gates, proposal gates, store query gates | Initial run exposed a brittle string assertion in `runtime-memory-persistence.test.ts`; Lane D fixed it to parse JSON and assert candidate fields. |
| `corepack pnpm run typecheck` | pass | Node and web TypeScript after test edit | none |
| Renderer IPC/Gateway bypass scan | pass/no matches | Renderer boundary | none |
| Service/exporter/listener scan | pass/reviewed | No implementation service/exporter/listener | Matches are docs/submission forbidden-boundary text only. |
| Raw-retention scan | pass/reviewed | Raw retention boundary | Matches are sanitizer denylist, negative fixtures/assertions, or Phase 9 docs/proof text. |

## Design Conflicts

| Conflict | Evidence | Proposed Resolution |
|---|---|---|
| Lane C says no durable Runtime Memory persistence implementation exists, but current workspace contains `memory-persistence.ts` and `runtime-memory-persistence.test.ts`. | `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-c-retention-redaction-rollback.md:44`; `openclaw_runtime/src/runtime-core/memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | Phase 9 synthesis should treat Lane C's no-implementation sentence as stale. Lane D's conclusion is based on current code: persistence exists, remains default-off, and is flag-off inert. |
| Bare `pnpm` is blocked by environment install approval. | Naked pnpm context/validate attempts failed with `ERR_PNPM_IGNORED_BUILDS`. | Keep recorded failures and use `corepack pnpm` proof, matching Lane F/Lane A environment notes. |
| Current worktree contains unrelated dirty Main/Gateway/host-api files. | `git status -sb` showed many pre-existing modified/untracked files outside Lane D. | Lane D touched only `tests/unit/runtime-memory-persistence.test.ts` and this submission; comms replay/compare is not required for Lane D-owned changes. |

## Final Decision

```text
Status: accepted
```
