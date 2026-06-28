# Line C Grounding Diagnostics Consumers Cross-Consumer Boundary Audit Implementation Synthesis

## Spec Decision Table

| Requirement | Decision | Evidence |
| --- | --- | --- |
| Fresh task spec | accepted | Created `harness/specs/tasks/line-c-grounding-diagnostics-consumers-cross-audit.md`. |
| Normal spec validate | blocked by unrelated checkout dirt | `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-cross-audit.md` failed because many unrelated dirty files outside this task's touched areas are present in the worktree. |
| Structural spec validate | accepted | `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-cross-audit.md --no-diff` passed. |
| Allowed implementation scope | accepted | Added one focused cross-consumer invariant test; no production runtime/provider code changed. |
| Authority boundary | accepted | Test proves Registry, Trace, Symbol, AgentMap, and Runtime Memory diagnostics metadata carry `authority: "none"`, `rawRetained: false`, and shared no-authority markers. |

## Design Research Decision Table

| Design point | Decision | Rationale |
| --- | --- | --- |
| Cross-consumer audit target | accepted | Compare Registry `groundingShadow` and Trace/Symbol/AgentMap/Runtime Memory `groundingDiagnostics` metadata only. |
| Runtime implementation | rejected for this phase | Existing consumers already share the accepted helper markers; the audit needed proof, not new runtime behavior. |
| Focused test implementation | accepted | Provider metadata mapping is local in each consumer, so a cross-consumer test protects against drift. |
| TaskLoop/Gateway/Main/renderer/provider transport/provider ordering/prompt assembly/memory promotion/persistence/patch apply/symbol mutation | rejected | These remain authoritative, transport, durable-state, or mutation boundaries and are outside diagnostics-only audit scope. |

## Implementation Surface Summary

Created:

- `harness/specs/tasks/line-c-grounding-diagnostics-consumers-cross-audit.md`
- `runtime-research/handoffs/line-c-grounding-diagnostics-consumers-cross-audit/design-research.md`
- `runtime-research/handoffs/line-c-grounding-diagnostics-consumers-cross-audit/implementation-synthesis.md`

Updated:

- `tests/unit/runtime-grounding-shadow-consumers.test.ts`
  - Added `keeps diagnostics metadata invariants aligned across Registry, Trace, Symbol, AgentMap, and Runtime Memory`.
  - The test instantiates each already-accepted explicit/default-off diagnostics path and asserts shared diagnostics-only, metadata-only, summary-only, readonly/local/shadow markers; `authority: "none"`; `rawRetained: false`; common no-authority markers; provider-specific no-authority markers; and safe query/item metadata.

No production runtime, provider, registry, TaskLoop, Gateway, Main, renderer, host-api, api-client, persistence, service, cache, exporter, listener, prompt assembly, provider ordering, memory promotion, symbol mutation, or patch-apply code was changed.

## Tests And Scans Results

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-cross-audit.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-cross-audit.md` | blocked by unrelated dirty checkout files outside this task's touched areas |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-cross-audit.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-runtime-memory-diagnostics-consumer.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-agentmap-diagnostics-consumer.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-specific-diagnostics-consumers.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-trace-diagnostics-expansion.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-runtime-shadow-pilot.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md --no-diff` | pass |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-shadow-consumers.test.ts` | pass, 1 file / 6 tests |
| `node node_modules/vitest/vitest.mjs run tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts` | pass, 10 files / 89 tests |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| `git diff --check -- <task files>` | pass |

RTK note: `rtk` was required by local instructions but is not available on PATH in this PowerShell session, and the Git Bash MCP tool was not exposed. Commands were run directly with PowerShell tool invocations and this limitation is recorded here.

Boundary scans:

- Renderer direct IPC/Gateway/WebSocket broad scan over `src/pages src/components electron shared` found existing owner/policy matches only: preload IPC bridge, Electron Gateway/WebSocket owner code, project-rule detection text, and i18n rule text.
- Focused renderer scan over `src/pages src/components` returned no matches.
- Service/exporter/listener/database scan over touched files matched only spec/design policy text; no production service, listener, database, sidecar, exporter, or cache code was added.
- Raw-retention scan over touched files matched expected `rawRetained`, `includeRaw`, sentinel tests, and spec policy text; tests prove raw sentinels do not survive output.
- Persistence/sidecar scan over touched files matched spec/design policy text and test `createRuntimeTraceSpanStore()` fixture use only; no persistence path was added.
- Memory mutation/fact promotion/episode write scan over touched files matched policy/design text and existing test names only; no mutation APIs were added.
- Mutation/patch apply scan over touched files matched policy/design text only.
- Authority scan found expected no-authority assertions and docs/spec policy text.
- `GroundingRef|GroundingQuery|grounding` scope scan outside intended runtime/context files found no new runtime wiring; matches were existing prompt prose around "grounding"/"backgrounding".
- Provider/default-registration scan found existing explicit diagnostics hooks and tests; no provider registration, default ordering, or provider ranking code changed.
- Context item/evidence ref invariants remain covered by existing Registry/Trace/Symbol/AgentMap/Runtime Memory provider tests, and the new cross-consumer test asserts only diagnostics metadata.

Comms replay/compare were not run because this task did not touch Main, Gateway, host-api, api-client, provider transport, gateway events, runtime send/receive, delivery, or fallback paths.

## Rejected-Boundary Audit

Rejected boundaries remain intact:

- No TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default provider registration, runtime execution, prompt assembly, or model-message cutover.
- No completion, blocked/failed status, retry, approval, security, verifier enforcement, provider selection, runtime state, tool policy, or memory promotion decision uses grounding output.
- No durable fact authority, fact candidate acceptance, fact acceptance, episode write, memory store write, invalidation proposal acceptance, or memory persistence mutation was added.
- No persistence, database, SQLite schema, JSONL sidecar, write path, cache, store, exporter, listener, service, daemon, HTTP server, WebSocket server, telemetry upload, or external service was added.
- No raw prompt, raw chat log, raw trace, full payload, full checkpoint, tool args, tool output, stdout, stderr, env, secret, API key, authorization header, traceparent, tracestate, baggage, raw memory fact, raw episode, transcript, JSONL import, or unbounded command output is retained by this task.
- No renderer direct IPC, direct Gateway HTTP, direct Gateway WebSocket, or renderer-owned protocol switching was added.
- No AST patch apply, workspace edit, rename, symbol edit apply, safe delete, symbol mutation, or mutating patch-planner behavior was added.

## Next Phase Decision

This cross-consumer diagnostics boundary audit is accepted. It proves GroundingRef and GroundingQuery currently enter Registry, Trace, Symbol, AgentMap, and Runtime Memory only as explicit/default-off diagnostics metadata or shadow summaries.

The next phase may plan another fresh accepted diagnostics-only task spec. It may continue comparing or testing GroundingRef/GroundingQuery as readonly, local, bounded, summary-only, metadata-only, diagnostics-only, non-authoritative material.

The next phase must not add TaskLoop/Gateway/Main/renderer/host-api/api-client/provider transport behavior, provider ordering/default registration, prompt/model-message assembly, runtime execution cutover, persistence/database/sidecar/exporter/listener/service/cache, memory promotion, fact acceptance, episode writes, memory store writes, invalidation acceptance, raw retention, symbol mutation, patch apply, workspace edit, rename, or safe delete.

## README Review

`README.md`, `README.zh-CN.md`, and `README.ja-JP.md` were reviewed with a focused scan for grounding, Runtime Memory, context provider, and diagnostics references. No README updates are required because this audit is internal, test/spec/handoff-only, explicit/default-off, diagnostics-only, and not exposed through UI, Gateway routes, settings, user-visible workflows, or public docs.

Status: accepted
