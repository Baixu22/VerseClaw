# Line C Grounding Diagnostics Authority Sentinel Hardening Implementation Synthesis

## Spec Decision Table

| Requirement | Decision | Evidence |
| --- | --- | --- |
| Fresh task spec | accepted | Created `harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-hardening.md`. |
| Normal spec validate | blocked by unrelated checkout dirt | `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-hardening.md` failed because many pre-existing dirty/untracked files outside this task's touched areas are present in the worktree. |
| Structural spec validate | accepted | `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-hardening.md --no-diff` passed. |
| Allowed implementation scope | accepted | Added one focused cross-consumer authority-sentinel fixture expansion and assertions. No production runtime code was changed. |
| Authority boundary | accepted | Test proves Registry, Trace, Symbol, AgentMap, and Runtime Memory diagnostics metadata keep `authority: "none"`, `rawRetained: false`, forced `includeRaw: false`, forced `includeUntrusted: false`, and shared/provider-specific no-authority markers while rejecting authority-grant sentinels. |

## Design Research Decision Table

| Design point | Decision | Rationale |
| --- | --- | --- |
| Cross-consumer target | accepted | Compare Registry `groundingShadow` and Trace/Symbol/AgentMap/Runtime Memory `groundingDiagnostics` metadata only. |
| Runtime implementation | rejected for this phase | Existing consumers already use explicit/default-off diagnostics paths, and the accepted drift guard sanitizer already rejects authority-like metadata text. |
| Focused negative/boundary test | accepted | The hostile fixture now covers trusted/untrusted refs, attempted `includeRaw`/`includeUntrusted`, raw-like metadata, runtime/completion/provider-ordering/prompt/durable-fact/memory-promotion/fact-acceptance/episode-write/memory-persistence/patch/symbol authority-grant sentinels, source/evidence anchors, memory promotion markers, and patch/symbol mutation markers. |
| Metadata-only fix | not needed | The expanded fixture passed without production sanitizer changes after preserving intended no-authority marker insertion order in the test metadata. |
| TaskLoop/Gateway/Main/renderer/provider transport/provider ordering/prompt assembly/memory promotion/persistence/patch apply/symbol mutation | rejected | These remain authoritative, transport, durable-state, or mutation boundaries and are outside diagnostics-only authority-sentinel scope. |

## Implementation Surface Summary

Created:

- `harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-hardening.md`
- `runtime-research/handoffs/line-c-grounding-diagnostics-authority-sentinel-hardening/design-research.md`
- `runtime-research/handoffs/line-c-grounding-diagnostics-authority-sentinel-hardening/implementation-synthesis.md`

Updated:

- `tests/unit/runtime-grounding-shadow-consumers.test.ts`
  - Added `AUTHORITY_GRANT_SENTINELS`.
  - Expanded the existing hostile cross-consumer diagnostics fixture to inject the full authority-grant sentinel matrix through options metadata and trusted ref metadata.
  - Added serialized metadata assertions proving none of those grant sentinels survive Registry, Trace, Symbol, AgentMap, or Runtime Memory diagnostics output.

No production runtime file was changed. No TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, provider registration, provider ordering, prompt assembly, model-message assembly, runtime execution, persistence, service, cache, exporter, listener, memory promotion, fact acceptance, episode write, memory store write, invalidation acceptance, symbol mutation, workspace edit, or patch-apply code was changed.

## Tests And Scans Results

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-hardening.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-hardening.md` | blocked by unrelated dirty checkout files outside this task's touched areas |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-hardening.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-drift-guard.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-cross-audit.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-runtime-memory-diagnostics-consumer.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-agentmap-diagnostics-consumer.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-specific-diagnostics-consumers.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-trace-diagnostics-expansion.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-runtime-shadow-pilot.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md --no-diff` | pass |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-shadow-consumers.test.ts` | pass, 1 file / 7 tests |
| `node node_modules/vitest/vitest.mjs run tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts` | pass, 10 files / 90 tests |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| `git diff --check -- harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-hardening.md runtime-research/handoffs/line-c-grounding-diagnostics-authority-sentinel-hardening/design-research.md runtime-research/handoffs/line-c-grounding-diagnostics-authority-sentinel-hardening/implementation-synthesis.md tests/unit/runtime-grounding-shadow-consumers.test.ts` | pass |

RTK note: `rtk` was required by local instructions but is not available on PATH in this PowerShell session (`rtk : The term 'rtk' is not recognized...`). Commands were run directly after recording this limitation.

Git Bash MCP note: the project requests the `bash-shell` MCP `bash_command` tool, but that tool was not exposed in this session after tool discovery. PowerShell `shell_command` was used instead and this limitation is recorded here.

Boundary scans:

- Renderer direct IPC/Gateway/WebSocket broad scan over `src/pages src/components electron shared` found existing owner/policy matches only: preload IPC bridge, Electron Gateway/WebSocket owner code, remote-control owner code, project-rule detection text, and localized rule text.
- Focused renderer scan over `src/pages src/components` returned no matches.
- Service/exporter/listener/database scan over touched files matched only spec policy text.
- Raw-retention scan over touched files matched expected spec/design policy text, `includeRaw`/`rawRetained` assertions, and intentional raw sentinel tests.
- Authority-grant sentinel scan over touched files matched design/spec policy text and the intentional `AUTHORITY_GRANT_SENTINELS` fixture/assertions only.
- Persistence/sidecar scan over touched files matched spec/design policy text and test `createRuntimeTraceSpanStore()` fixture use only; no persistence path was added.
- Memory mutation/fact promotion/episode write scan over touched files matched policy/design/test text only; no mutation APIs were added.
- Mutation/patch apply scan over touched files matched policy/design text only.
- Authority scan found expected no-authority assertions, docs/spec policy text, and the intentional sentinel fixture.
- `GroundingRef|GroundingQuery|grounding` scope scan outside intended runtime/context files found existing prompt prose around grounding/backgrounding; no new runtime wiring was added.
- Provider/default-registration scan found existing explicit diagnostics hooks, provider manifests, ordering constants, and tests; no provider registration, default ordering, provider ranking, or provider priority code changed.
- Context item/evidence ref invariants are covered by the hostile cross-consumer test for Trace, Symbol, AgentMap, and Runtime Memory, plus existing provider-specific absent/disabled diagnostics tests.

Comms replay/compare were not run because this task did not touch Main, Gateway, host-api, api-client, provider transport, gateway events, runtime send/receive, delivery, or fallback paths.

## Rejected-Boundary Audit

Rejected boundaries remain intact:

- No TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default provider registration, runtime execution, prompt assembly, or model-message cutover.
- No completion, blocked/failed status, retry, approval, security, verifier enforcement, provider selection, runtime state, tool policy, or memory promotion decision uses grounding output.
- No durable fact authority, fact candidate acceptance, fact acceptance, episode write, memory store write, invalidation proposal acceptance, or memory persistence mutation was added.
- No persistence, database, SQLite schema, JSONL sidecar, write path, cache, store, exporter, listener, service, daemon, HTTP server, WebSocket server, telemetry upload, or external service was added.
- No raw prompt, raw chat log, raw trace, full payload, full checkpoint, tool args, tool output, stdout, stderr, env, secret, API key, authorization header, traceparent, tracestate, baggage, raw memory fact, raw episode, transcript, JSONL import, unbounded command output, or authority-grant sentinel is retained by this task.
- No renderer direct IPC, direct Gateway HTTP, direct Gateway WebSocket, or renderer-owned protocol switching was added.
- No AST patch apply, workspace edit, rename, symbol edit apply, safe delete, symbol mutation, or mutating patch-planner behavior was added.

## Next Phase Decision

This authority-sentinel hardening proof is accepted. It proves GroundingRef and GroundingQuery currently enter Registry, Trace, Symbol, AgentMap, and Runtime Memory only as explicit/default-off diagnostics metadata or shadow summaries, even when hostile inputs attempt to grant runtime, completion, provider-ordering, prompt, durable-fact, memory-promotion, fact-acceptance, episode-write, memory-persistence, patch-mutation, or symbol-mutation authority.

The next phase may plan another fresh accepted diagnostics-only task spec. It may continue comparing or testing GroundingRef/GroundingQuery as readonly, local, bounded, summary-only, metadata-only, diagnostics-only, non-authoritative material.

The next phase must not add TaskLoop/Gateway/Main/renderer/host-api/api-client/provider transport behavior, provider ordering/default registration, prompt/model-message assembly, runtime execution cutover, persistence/database/sidecar/exporter/listener/service/cache, memory promotion, fact acceptance, episode writes, memory store writes, invalidation acceptance, raw retention, symbol mutation, patch apply, workspace edit, rename, or safe delete.

## README Review

`README.md`, `README.zh-CN.md`, and `README.ja-JP.md` were reviewed with a focused scan for grounding, diagnostics, Runtime Memory, and context provider references. No README updates are required because this hardening proof is internal, explicit/default-off, diagnostics-only, metadata-only, and not exposed through UI, Gateway routes, settings, user-visible workflows, or public docs.

## TypeScript Blocker Review

TypeScript passed with `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`. No `pnpm install` or retry was needed for this checkout.

Status: accepted
