# Phase 12 Synthesis: Runtime Memory Cutover Readiness

## Decision

Phase 12 is accepted as planning/spec/evidence only.

This synthesis accepts the Phase 12 task spec, handoff package, Lane A-E readiness maps, and validation evidence required before a later cutover spec can be drafted. It does not accept TaskLoop cutover, Gateway cutover, runtime call-site imports, provider registration/order cutover, default-on persistence, raw retention, unverified durable facts, service/exporter/database-service/listener work, or memory-derived runtime authority.

The current worktree has unrelated dirty Main/Gateway/host-api/shared/provider-adjacent files, and `runtime-research/agent-runtime-index.md` already had Phase 12 spec-only planning text before this synthesis existed. Those are not treated as Phase 12 runtime acceptance. The accepted Phase 12 scope remains the planning/spec/evidence surfaces under `harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md` and `runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/**`.

## Prerequisite Audit

| Gate | Result | Evidence |
|---|---|---|
| Phase 11 synthesis exists and ends exactly accepted | pass | `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md` final content line rechecked as `Status: accepted`. |
| Phase 11 accepted only isolated default-off adapter wiring | pass | Phase 11 decision accepts `memory-runtime-integration.ts`, disabled parity, sanitized adapter read/write proof, explicit extra-provider hydration, and config wording only. |
| Phase 10 accepted only default-off integration boundary/readiness | pass | Phase 10 synthesis decision rejects runtime read/write wiring and provider-order/default-on cutover. |
| Phase 9 accepted only default-off local sanitized persistence foundation | pass | Phase 9 synthesis decision rejects runtime cutover, default-on behavior, raw retention, and runtime authority. |

## Lane Classification

| Lane | Classification | Reason |
|---|---|---|
| Lane A: TaskLoop import and call-site cutover risk map | accepted | Maps future TaskLoop/Gateway/runtime call-site import risks and required proof. It adds no adapter/persistence import or runtime call site. |
| Lane B: Provider registration and provider ordering cutover risk map | accepted | Maps provider registration/order risks, preserves legacy -> loop -> explicit extras ordering, and rejects default Runtime Memory provider registration. |
| Lane C: Durable fact promotion authority gate proof plan | accepted | Requires source episode refs, evidence refs, accepted verification status, finite `acceptedAt`, and verifier/human/deterministic-rule promotion evidence before durable facts can influence runtime context. |
| Lane D: Rollback, operator, docs, and config proof plan | accepted | Keeps memory flags default false and defines rollback by disabling flags, omitting adapter imports, omitting provider registration, preserving Phase 9 rows, and retaining legacy runtime authority. |
| Lane E: Validation, scans, and comms proof plan | accepted | Confirms A-D existence/status and records required harness validation, tests, typecheck, scans, and comms replay/compare. |

Each Phase 12 lane submission has exactly one valid status marker, and each marker is `Status: accepted`.

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| Phase 12 stayed planning/spec/evidence only | pass | Phase 12 submissions and this synthesis are handoff/spec evidence. No runtime behavior is accepted. |
| No TaskLoop/Gateway/runtime call-site import was added | pass | Runtime authority scan over `openclaw_runtime/src/agents`, `openclaw_runtime/src/gateway`, `electron`, `shared`, `src/lib`, default provider registry, and runtime-core barrel returned no matches for the adapter/persistence-owner import patterns. |
| No provider registration/order cutover was added | pass | Provider default registration scan returned no matches. Lane B preserves legacy provider -> loop provider -> explicit extras ordering. |
| No default-on persistence was accepted | pass | Runtime memory flags remain default false. Default-on scan matches were explicit opt-in tests, config help/labels, or unrelated context-provider shadow options. |
| No raw retention was accepted | pass | Focused raw-retention scan matches are sanitizer denylist/redaction code or negative fixtures/assertions. Focused persistence/adapter tests passed. |
| No unverified durable facts were accepted | pass | Lane C and focused tests preserve candidate/durable separation, accepted verification status, finite `acceptedAt`, promotion evidence, and default current-valid exclusions. |
| No service/exporter/database-service/listener work was accepted | pass | Focused service/exporter/database-service/listener scan over Runtime Memory source/tests returned no matches. |
| No memory-derived runtime authority was accepted | pass | Provider metadata remains readonly/no completion/verifier/security/retry/tool/runtime authority; no authority-path imports were found. |
| Renderer/Main boundary preserved | pass | Renderer scan over `src/pages` and `src/components` returned no direct IPC, localhost Gateway HTTP/WebSocket, or `new WebSocket` bypass matches. |
| Broad persistence scan reviewed | pass | Matches are intended Phase 9/11 Runtime Memory persistence/adapter/tests plus unrelated existing transcript/session/sqlite surfaces; no Phase 12 cutover is accepted. |

## Validation

| Command / Check | Result |
|---|---|
| `rtk.exe node.exe harness/src/cli.mjs context --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md` | pass |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md` | pass |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md` | pass |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass |
| Focused Runtime Memory/TaskLoop Vitest command from the Phase 12 spec | pass, 9 files / 99 tests |
| `rtk.exe node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| Renderer boundary scan | pass/no matches |
| Runtime authority import scan | pass/no matches |
| Provider/default registration scan | pass/no matches |
| Focused raw-retention scan | pass/reviewed expected sanitizer and negative-test matches |
| Focused service/exporter/database-service/listener scan | pass/no matches |
| Broad persistence scan | pass/reviewed intended Runtime Memory persistence/adapter/tests and unrelated existing transcript/sqlite surfaces |
| `rtk.exe node.exe scripts/comms/replay.mjs` | pass |
| `rtk.exe node.exe scripts/comms/compare.mjs` | pass |

Comms replay/compare were rerun because the ambient worktree contains dirty Main/Gateway/host-api/shared/provider-adjacent paths, even though Phase 12 itself accepts only planning/spec/evidence.

## Rejected Claims

| Claim | Decision |
|---|---|
| TaskLoop, Gateway, runtime execution, or runtime call-site cutover | rejected |
| Importing or invoking the Phase 11 adapter from runtime authority paths | rejected |
| Default Runtime Memory provider registration or provider ordering cutover | rejected |
| `runtime.memory.persist` enabling provider output or runtime authority | rejected |
| Default-on memory recording, persistence, provider output, extraction, promotion, or prompt memory dumps | rejected |
| Raw chat-log, transcript, JSONL, trace, prompt, payload, checkpoint, tool args/output, env, secret, traceparent, tracestate, or baggage retention | rejected |
| Candidate, rejected, invalidated, expired, LLM-derived, or unpromoted facts becoming durable facts | rejected |
| Service, exporter, database-service, listener, daemon, HTTP/WebSocket server, OTLP collector/exporter, Temporal service, second Gateway, or second runtime work | rejected |
| Memory-derived completion gates, verifier authority, security policy, retry policy, tool permission authority, runtime execution policy, or runtime authority | rejected |

## Next Decision

A later cutover phase must start from a fresh task spec and synthesis before accepting any TaskLoop/Gateway/runtime call-site import, provider registration/order change, operator-facing persistence flow, default-on memory behavior, automatic extraction/promotion, raw retention, service/exporter/database-service/listener work, or memory-derived runtime authority.

Status: accepted
