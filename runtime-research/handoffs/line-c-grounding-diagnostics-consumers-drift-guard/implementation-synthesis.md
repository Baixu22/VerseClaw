# Line C Grounding Diagnostics Consumers Drift Guard Implementation Synthesis

## Spec Decision Table

| Requirement | Decision | Evidence |
| --- | --- | --- |
| Fresh task spec | accepted | Created `harness/specs/tasks/line-c-grounding-diagnostics-consumers-drift-guard.md`. |
| Normal spec validate | blocked by unrelated checkout dirt | `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-drift-guard.md` failed because many pre-existing dirty files outside this task's touched areas are present in the worktree. |
| Structural spec validate | accepted | `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-drift-guard.md --no-diff` passed. |
| Allowed implementation scope | accepted | Added one focused cross-consumer negative/boundary test and one metadata-only sanitizer drift fix. No runtime call paths, provider registration, provider ordering, prompt assembly, persistence, memory promotion, transport, symbol mutation, or patch-apply behavior changed. |
| Authority boundary | accepted | Test proves Registry, Trace, Symbol, AgentMap, and Runtime Memory diagnostics metadata carry `authority: "none"`, `rawRetained: false`, forced `includeRaw: false`, forced `includeUntrusted: false`, and shared/provider-specific no-authority markers. |

## Design Research Decision Table

| Design point | Decision | Rationale |
| --- | --- | --- |
| Cross-consumer drift target | accepted | Compare Registry `groundingShadow` and Trace/Symbol/AgentMap/Runtime Memory `groundingDiagnostics` metadata only. |
| Runtime implementation | rejected for this phase | Existing consumers already use explicit/default-off diagnostics paths; drift proof needed tests and a sanitizer marker fix only. |
| Focused negative/boundary test | accepted | The hostile fixture covers trusted/untrusted refs, attempted `includeRaw`/`includeUntrusted`, raw-like metadata, provider-specific authority sentinels, source/evidence anchors, memory promotion markers, and patch/symbol mutation markers. |
| Metadata-only fix | accepted | The new sanitizer rejects authority-grant sentinel text such as `providerOrderingAuthority:yes` while preserving `authority: "none"` and `no*Authority` markers. |
| TaskLoop/Gateway/Main/renderer/provider transport/provider ordering/prompt assembly/memory promotion/persistence/patch apply/symbol mutation | rejected | These remain authoritative, transport, durable-state, or mutation boundaries and are outside diagnostics-only drift-guard scope. |

## Implementation Surface Summary

Created:

- `harness/specs/tasks/line-c-grounding-diagnostics-consumers-drift-guard.md`
- `runtime-research/handoffs/line-c-grounding-diagnostics-consumers-drift-guard/design-research.md`
- `runtime-research/handoffs/line-c-grounding-diagnostics-consumers-drift-guard/implementation-synthesis.md`

Updated:

- `openclaw_runtime/src/runtime-core/grounding.ts`
  - Added `GROUNDING_AUTHORITY_METADATA_TEXT_PATTERN`.
  - Extended `isRawGroundingMetadataText()` to reject authority-grant metadata sentinel text while leaving explicit no-authority markers intact.
- `tests/unit/runtime-grounding-shadow-consumers.test.ts`
  - Added `keeps hostile grounding diagnostics metadata non-authoritative across all consumers`.
  - The test compares enabled diagnostics to baseline `contextItems` and `evidenceRefs` for Trace, Symbol, AgentMap, and Runtime Memory; checks Registry default provider ordering; asserts shared/provider-specific no-authority markers; proves untrusted refs and raw-like sentinels do not survive; and proves attempted `includeRaw`/`includeUntrusted` are forced off.

No TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, provider registration, provider ordering, prompt assembly, model-message assembly, runtime execution, persistence, service, cache, exporter, listener, memory promotion, fact acceptance, episode write, memory store write, invalidation acceptance, symbol mutation, workspace edit, or patch-apply code was changed.

## Tests And Scans Results

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-drift-guard.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-drift-guard.md` | blocked by unrelated dirty checkout files outside this task's touched areas |
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
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts` | pass, 2 files / 17 tests |
| `node node_modules/vitest/vitest.mjs run tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts` | pass, 10 files / 90 tests |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| `git diff --check -- harness/specs/tasks/line-c-grounding-diagnostics-consumers-drift-guard.md runtime-research/handoffs/line-c-grounding-diagnostics-consumers-drift-guard/design-research.md openclaw_runtime/src/runtime-core/grounding.ts tests/unit/runtime-grounding-shadow-consumers.test.ts` | pass for tracked diffs; files are currently untracked in this checkout, so separate no-index checks were also attempted |
| `git diff --no-index --check -- NUL <touched-file>` | no whitespace error output; Git returned line-ending warnings because LF will be replaced by CRLF |

RTK note: `rtk` was required by local instructions but is not available on PATH in this PowerShell session (`rtk : The term 'rtk' is not recognized...`). Commands were run directly after recording this limitation.

Git Bash MCP note: the project requests the `bash-shell` MCP `bash_command` tool, but that tool was not exposed in this session after tool discovery. PowerShell `shell_command` was used instead and this limitation is recorded here.

Boundary scans:

- Renderer direct IPC/Gateway/WebSocket broad scan over `src/pages src/components electron shared` found existing owner/policy matches only: preload IPC bridge, Electron Gateway/WebSocket owner code, project-rule detection text, and i18n rule text.
- Focused renderer scan over `src/pages src/components` returned no matches.
- Service/exporter/listener/database scan over touched files matched only spec policy text.
- Raw-retention scan over touched files matched expected `rawRetained`, `includeRaw`, sentinel tests, and sanitizer patterns; tests prove raw sentinels and raw-like keys do not survive output.
- Persistence/sidecar scan over touched files matched spec/design policy text and test `createRuntimeTraceSpanStore()` fixture use only; no persistence path was added.
- Memory mutation/fact promotion/episode write scan over touched files matched policy/design text, test names, and the sanitizer authority-denial regex only; no mutation APIs were added.
- Mutation/patch apply scan over touched files matched policy/design text only.
- Authority scan found expected no-authority assertions, docs/spec policy text, and the new metadata-only sanitizer regex.
- `GroundingRef|GroundingQuery|grounding` scope scan outside intended runtime/context files found existing prompt prose around "grounding"/"backgrounding"; no new runtime wiring was added.
- Provider/default-registration scan found existing explicit diagnostics hooks and tests; no provider registration, default ordering, or provider ranking code changed.
- Context item/evidence ref invariants are covered by the new drift-guard test for Trace, Symbol, AgentMap, and Runtime Memory, and by existing Registry/Trace/Symbol/AgentMap/Runtime Memory provider tests.

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

This drift guard is accepted. It proves GroundingRef and GroundingQuery currently enter Registry, Trace, Symbol, AgentMap, and Runtime Memory only as explicit/default-off diagnostics metadata or shadow summaries.

The next phase may plan another fresh accepted diagnostics-only task spec. It may continue comparing or testing GroundingRef/GroundingQuery as readonly, local, bounded, summary-only, metadata-only, diagnostics-only, non-authoritative material.

The next phase must not add TaskLoop/Gateway/Main/renderer/host-api/api-client/provider transport behavior, provider ordering/default registration, prompt/model-message assembly, runtime execution cutover, persistence/database/sidecar/exporter/listener/service/cache, memory promotion, fact acceptance, episode writes, memory store writes, invalidation acceptance, raw retention, symbol mutation, patch apply, workspace edit, rename, or safe delete.

## README Review

`README.md`, `README.zh-CN.md`, and `README.ja-JP.md` were reviewed with a focused scan for grounding, Runtime Memory, context provider, and diagnostics references. No README updates are required because this drift guard is internal, explicit/default-off, diagnostics-only, metadata-only, and not exposed through UI, Gateway routes, settings, user-visible workflows, or public docs.

## TypeScript Blocker Review

TypeScript passed with `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`. No `pnpm install` or retry was needed for this checkout.

Status: accepted
