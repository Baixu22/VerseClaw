# Phase 3 Provider Tool Registry Controlled Diagnostic Consumer Pilot Execution Synthesis

Status: accepted_registry_diagnostic_consumer_pilot_execution_ready

## Overall Status

accepted_registry_diagnostic_consumer_pilot_execution_ready

This execution slice proves the Registry-only controlled diagnostic consumer pilot with a test-owned, in-memory sample corpus and a bounded runtime-core operator report helper. It does not introduce production runtime authority, provider ordering cutover, default provider registration, automatic provider enablement, TaskLoop authority, prompt/model-message changes, Gateway/provider transport changes, diagnostic persistence, renderer bypass, or services/listeners/databases.

`buildProviderToolRegistryControlledDiagnosticConsumerReport()` is the explicit in-memory report entry for this execution proof. It consumes caller-provided diagnostics through the existing controlled consumer, fails closed when the consumer or required flags are absent, filters malformed diagnostics, bounds evidence refs, classifies included diagnostics into actionable/noise/review-required buckets, and emits explicit no-authority metadata. It does not register a default caller, persist data, or change provider ordering.

## Why Registry Is The Chosen Direction

Registry is the chosen direction because the prerequisite and deep-validation handoffs accepted registry diagnostics as the next pilot surface while rejecting the current AST pilot for this phase. Registry consumes already-shaped diagnostics from the accepted collector, provides bounded operator summaries, keeps omitted counts explicit, and preserves legacy behavior as authoritative.

Evidence sources:

- `runtime-research/handoffs/runtime-use-prerequisites.md`: accepted runtime-use prerequisites and default-off registry collector flags.
- `runtime-research/handoffs/controlled-runtime-use-pilot-deep-validation/results.md`: accepted registry direction and rejected current AST pilot direction.
- `runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/synthesis.md`: accepted shadow-only diagnostic collector MVP.
- `openclaw_runtime/src/runtime-core/registries.ts`: bounded controlled diagnostic consumer report helper.
- `tests/unit/runtime-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution.test.ts`: 32-sample execution corpus, disabled-by-default report proof, and metrics gate.

## What Was Explicitly Not Touched

- AST implementation, integration, optimization, invocation, docs, specs, and tests were not changed.
- Provider ordering cutover was not implemented.
- Default provider registration and automatic provider enablement were not added.
- Active provider/tool authority was not added.
- TaskLoop decision, completion, checkpoint, lifecycle, self-check, and final status authority were not changed.
- Prompt, model-message, reviewer prompt, Gateway payload, provider transport, runtime send/receive, delivery, and fallback behavior were not changed.
- MCP response shape, approval waiting/blocked semantics, retry behavior, and error semantics were not changed.
- Diagnostic persistence was not added outside the in-memory test fixture.
- Services, listeners, daemons, WebSocket servers, local HTTP servers, second Gateways, second runtimes, and external databases were not added.
- Renderer direct IPC and direct Gateway HTTP/WebSocket calls were not added.
- Registry UI, settings, public config, and user-visible docs were not changed.

## Sample Matrix Summary

The focused test owns 32 Registry-only samples plus a default-closed report assertion. Every sample records input, expected output, failure mode, boundary assertion, evidence source, actionability classification, and expected metrics contribution. Each sample also verifies the bounded operator report status, counts, sanitized metadata/evidence, finite actionability buckets, and explicit no-authority metadata.

Covered sample classes:

- normal/no diagnostics
- registered context provider
- legacy authoritative fallback
- provider exception
- unsupported MCP content
- policy denied
- policy waiting
- tool cancelled
- tool error
- runtime unavailable
- unknown provider
- disabled provider
- duplicate provider
- invalid manifest
- invalid injected diagnostics
- over-limit diagnostics
- gated-off behavior
- provider-ordering-sensitive case
- TaskLoop shadow gate closed
- TaskLoop all gates open with legacy authority unchanged
- renderer bypass sentinel
- persistence sentinel
- service/listener/database sentinel
- built-in host tool compatibility
- no-result diagnostic
- timeout diagnostic
- provider error diagnostic
- capability unsupported diagnostic
- flag-disabled provider
- registered tool provider
- context provider exception
- mixed over-limit collector input

Actionability classes:

- actionable: 19 samples
- informational: 10 samples
- noise: 3 samples

## Metrics Results

Bounded summary from the focused execution test:

| Metric | Result |
|---|---:|
| diagnostic_count | 31 |
| omitted_diagnostic_count | 5 |
| invalid_injected_diagnostic_count | 1 |
| actionable_rate | 59.375% |
| noise_rate | 9.375% |
| collector_latency_ms | bounded under 100ms in test |
| fail_closed_rate | 100% |
| provider_ordering_drift | 0 |
| legacy_behavior_drift | 0 |
| renderer_bypass | 0 |
| persistence_matches | 0 |
| service_listener_database_matches | 0 |

Included diagnostics by status:

| Status | Count |
|---|---:|
| ok | 4 |
| fallback | 5 |
| waiting | 1 |
| denied | 1 |
| cancelled | 1 |
| error | 14 |
| skipped | 5 |

Included diagnostics by reason:

| Reason | Count |
|---|---:|
| registered | 2 |
| legacy_authoritative | 7 |
| provider_exception | 2 |
| unsupported_content | 1 |
| policy_denied | 1 |
| policy_waiting | 1 |
| tool_cancelled | 1 |
| tool_error | 4 |
| runtime_unavailable | 1 |
| unknown_provider | 1 |
| provider_disabled | 1 |
| duplicate_provider | 1 |
| manifest_invalid | 1 |
| provider_error | 3 |
| no_result | 1 |
| timeout | 1 |
| capability_unsupported | 1 |
| flag_disabled | 1 |

## Boundary Scan Summary

Expected forbidden-text matches are allowed only in the task spec, this synthesis, focused test sentinel labels, and pre-existing locale `rename` labels. The only production Registry runtime source change is the explicit in-memory report helper in `openclaw_runtime/src/runtime-core/registries.ts`; it has no production caller and does not enable the consumer by default.

Required boundary scan expectations:

- AST/apply/mutation scan: may match forbidden text in docs/spec only; no production AST surface touched.
- provider ordering/default/provider transport/TaskLoop authority scan: may match forbidden text and sentinel names only; no production authority surface touched.
- renderer direct IPC/Gateway scan: must remain no matches in `src/pages` and `src/components`.
- persistence scan: may match forbidden text and sentinel names only; no diagnostic persistence added.
- service/listener/database scan: may match forbidden text and sentinel names only; no service/listener/database added.

## Files Changed

- `harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution.md`
- `openclaw_runtime/src/runtime-core/registries.ts`
- `tests/unit/runtime-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution.test.ts`
- `runtime-research/handoffs/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution/synthesis.md`

## Commands Run

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution.md`: pass.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution.md`: blocked by unrelated dirty/untracked files outside this task spec's touched areas.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution.md --no-diff`: pass.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts`: pass, 6 files / 110 tests.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution.test.ts`: pass, 1 file / 2 tests.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/runtime-controlled-runtime-use-deep-validation.test.ts`: pass, 2 files / 16 tests.
- `pnpm --config.verify-deps-before-run=false run typecheck`: blocked by unrelated `openclaw_runtime/src/runtime-core/failure-intelligence-passive-shadow.ts(53,6)` unused `Classification` type.
- `rg -n "astPatchPlanner|AST Patch Planner|scanAstPatchPlanner|applyPatch|workspaceEdit|rename|replaceBody|insertBefore|insertAfter|safeDelete" <touched files>`: matches only forbidden text, scan text, and pre-existing locale `rename` labels.
- `rg -n "provider ordering|default provider|default-on|prompt cutover|model messages|Gateway request|provider transport|TaskLoop authority|tool authority" <touched files>`: matches only forbidden text/synthesis boundary text.
- `rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components`: pass, no matches.
- `rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <touched files>`: matches only the scan text in the task spec.
- `rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|@temporalio|express\\(" <touched files>`: matches only forbidden text and required sentinel labels.
- `git diff --check -- <touched files>`: pass.

## Rollback

- Disable `runtime.registryDiagnostics.collector`.
- Disable `runtime.registryPilot.enabled`.
- Disable `runtime.providerRegistry.shadow`.
- Disable `runtime.contextProviders.registryPilot`.
- Disable `runtime.toolRegistry.shadow`.
- Delete or stop injecting registry diagnostics.
- Keep legacy context, MCP, TaskLoop, Gateway, provider transport, and renderer/Main behavior authoritative.

No persisted cleanup is required because the pilot execution uses only in-memory test-owned fixtures.

## Remaining Forbidden Surfaces

- AST implementation, integration, optimization, invocation, docs, specs, tests, and re-evaluation.
- Provider ordering cutover, default provider registration, automatic provider enablement, active provider authority, active tool authority, TaskLoop authority, prompt authority, completion authority, or default-on registry behavior.
- MCP response shape, approval/retry/error semantic changes, lifecycle/final-status/self-check/checkpoint authority changes, reviewer prompt/model-message/Gateway payload/provider transport changes, runtime send/receive/delivery/fallback behavior changes.
- Diagnostic persistence outside explicit in-memory/test-owned fixtures.
- Services, listeners, daemons, WebSocket servers, local HTTP servers, second Gateways, second runtimes, external databases, non-MCP transports, or default cutover.
- Renderer direct IPC or direct Gateway HTTP/WebSocket.

## Next Allowed Slice

The next allowed slice is a Registry-only real-producer diagnostic consumer validation run. It must tighten the validation boundary before any expansion: consume diagnostics generated by existing context, tool/MCP, and TaskLoop shadow seams in memory; measure actionability/noise, latency, omission accounting, leakage, and drift; and keep behavior diagnostics-only, default-off, reversible, and non-authoritative.

See `runtime-research/handoffs/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution/boundary-diagnosis-and-next-plan.md`.
