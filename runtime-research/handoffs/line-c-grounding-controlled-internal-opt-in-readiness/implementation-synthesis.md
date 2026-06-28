# Line C Grounding Controlled Internal Opt-in Readiness Implementation Synthesis

## Spec Decision Table

| Requirement | Decision | Evidence |
| --- | --- | --- |
| Fresh task spec | accepted | `harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-readiness.md` created; context passed and structural validate passed. |
| Controlled internal opt-in only | accepted | Spec rejects default-on, runtime authority, prompt/model-message/provider ordering/runtime decision/memory promotion/persistence/UI cutover. |
| Production code change | rejected for this stage | This readiness slice is docs/spec/report/index only. |
| Default-off parity | accepted | Required focused tests passed; absent/disabled diagnostics remain covered by provider-specific baseline tests. |
| Explicit opt-in diagnostics | accepted | Required focused tests cover Registry `groundingShadow` and Trace/Symbol/AgentMap/Runtime Memory `groundingDiagnostics`. |
| Raw and authority sentinel boundary | accepted | Effectiveness metrics report zero raw leaks and zero authority-grant leaks across the hostile sentinel matrix. |

## Implementation Surface Summary

Created:

- `harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-readiness.md`
- `runtime-research/handoffs/line-c-grounding-controlled-internal-opt-in-readiness/README.md`
- `runtime-research/handoffs/line-c-grounding-controlled-internal-opt-in-readiness/design-research.md`
- `runtime-research/handoffs/line-c-grounding-controlled-internal-opt-in-readiness/implementation-synthesis.md`
- `runtime-research/handoffs/line-c-grounding-controlled-internal-opt-in-readiness/deep-validation.md`

Updated:

- `runtime-research/agent-runtime-index.md`

No production runtime, provider, registry, TaskLoop, Gateway, Main, renderer, host-api, api-client, persistence, service, cache, exporter, listener, prompt assembly, provider ordering, memory promotion, symbol mutation, or patch-apply code was changed.

## Deep Validation Result Table

| Gate | Observed | Threshold | Status |
| --- | ---: | ---: | --- |
| Consumer coverage | 5 | 5 | pass |
| Sentinel class coverage | 14 | >= 14 | pass |
| Hostile input location coverage | 5 | >= 5 | pass |
| Leak count | 0 | 0 | pass |
| Raw leak count | 0 | 0 | pass |
| Authority grant leak count | 0 | 0 | pass |
| `includeRaw` forced false rate | 1 | 1 | pass |
| `includeUntrusted` forced false rate | 1 | 1 | pass |
| Untrusted ref exclusion rate | 1 | 1 | pass |
| Context item diff count | 0 | 0 | pass |
| Evidence ref diff count | 0 | 0 | pass |
| Provider ordering diff count | 0 | 0 | pass |
| Diagnostics metadata-only score | 1 | 1 | pass |
| No-authority marker completeness score | 1 | 1 | pass |
| Regression proof confidence score | 1 | 1 | pass |

## Test And Scan Results

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-readiness.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-readiness.md` | blocked by unrelated dirty checkout files outside this task's touched areas |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-readiness.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-effectiveness-evaluation.md --no-diff` | pass |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts` | pass, 7 files / 50 tests |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| `git diff --check -- <controlled-internal-opt-in-readiness-touched-files>` | pass; Git printed an LF-to-CRLF warning for `runtime-research/agent-runtime-index.md` only |
| `git diff --no-index --check -- <empty-temp-file> <new-file>` for each new spec/handoff file | pass; Git printed LF-to-CRLF working-copy warnings only |

Boundary scans:

| Scan | Result |
| --- | --- |
| Renderer/Main broad fixed-string scan over `src`, `electron`, `shared` | Existing rule/i18n text and Main-owned Electron WebSocket owner code only; no new renderer bypass from this task. |
| Focused scan over `src/pages` and `src/components` | No direct IPC, direct Gateway HTTP, direct WebSocket, `gateway:httpProxy`, or `hostapi:fetch` matches. |
| Service/exporter/listener/database scan over touched files | Matches only spec/report/index rejected-boundary text; no production code was touched. |
| Raw-retention scan over touched files | Matches only spec/report/index rejected-boundary text and accepted metric names; no raw retention path was added. |
| Authority-grant scan over touched files | Matches only spec/report/deep-validation policy text and metric names. |
| Memory promotion/fact acceptance/episode write scan over touched files | Matches only rejected-boundary text in the spec/report/index. |
| Patch/workspace/symbol mutation scan over touched files | Matches only rejected-boundary text in the spec/report/index. |

RTK note: local instructions require prefixing shell commands with `rtk`, but `rtk` was not available on PATH in this PowerShell session. Commands were run directly after recording that limitation.

Git Bash MCP note: the project requests the `bash-shell` MCP `bash_command` tool, but that tool was not exposed in this session. PowerShell `shell_command` was used instead.

Comms replay/compare were not run because this task did not touch Main, Gateway, host-api, api-client, provider transport, gateway events, runtime send/receive, delivery, or fallback paths.

## Rejected-Boundary Audit

Rejected boundaries remain intact:

- No default-on grounding diagnostics or production cutover.
- No TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default provider registration, runtime execution, prompt assembly, or model-message cutover.
- No completion, retry, approval, security, verifier, provider selection, tool policy, or runtime state authority from grounding output.
- No durable fact authority, fact acceptance, memory promotion, episode write, memory store write, invalidation acceptance, or memory persistence mutation.
- No persistence, database, SQLite schema, JSONL sidecar, write path, cache, store, exporter, listener, service, daemon, HTTP server, WebSocket server, telemetry upload, or external service.
- No raw prompt, raw chat log, raw trace, full payload, full checkpoint, tool args/output, stdout/stderr, env, secret, API key, authorization header, traceparent, tracestate, baggage, raw memory fact, raw episode, transcript, JSONL import, or authority-grant sentinel retention.
- No renderer direct IPC, direct Gateway HTTP, direct Gateway WebSocket, or renderer-owned protocol switching.
- No AST patch apply, workspace edit, rename, safe delete, symbol mutation, or mutating patch-planner behavior.

## README Review

`README.md`, `README.zh-CN.md`, and `README.ja-JP.md` were reviewed with a focused scan for grounding, diagnostics, Runtime Grounding, and context provider references. Existing matches describe unrelated user-visible diagnostics/observability/agent-dev surfaces. No README updates are required because this readiness stage is internal, docs/spec/report-only, explicit/default-off, diagnostics-only, metadata-only, and does not expose UI, settings, commands, Gateway routes, host APIs, renderer behavior, or public user flows.

## Final Status

Line C is accepted for controlled internal opt-in readiness only. It remains explicit/default-off, readonly, local, bounded, summary-only, diagnostics/metadata-only, and non-authoritative.

Status: accepted
