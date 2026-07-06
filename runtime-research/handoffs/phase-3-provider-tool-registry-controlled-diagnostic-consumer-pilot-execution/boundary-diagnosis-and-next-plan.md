# Registry Diagnostic Consumer Boundary Diagnosis And Next Plan

Status: accepted_boundary_diagnosis_tighten_next

## Decision

Next chain decision: tighten before expanding.

The Registry diagnostic consumer pilot execution is accepted, but its strongest evidence is still a test-owned, in-memory sample corpus. That is enough to prove collector value, bounded metrics, fail-closed behavior, and authority boundaries. It is not enough to justify default-on behavior, production authority, persistence, public UI, provider ordering cutover, or TaskLoop/Gateway/provider transport changes.

## Real Validation Boundary

Verified now:

- The collector remains default-off by omission.
- `collectRuntimeRegistryDiagnostics()` is present as the runtime-core collector surface, but production code does not call it as an active consumer.
- TaskLoop registry shadow diagnostics still require explicit injected diagnostics plus every relevant registry/shadow gate.
- Renderer pages/components do not bypass host-api or Gateway ownership.
- The accepted execution test covers 32 registry-only in-memory samples and asserts explicit omission accounting, actionability/noise rates, fail-closed rate, and zero drift across provider ordering, legacy behavior, renderer bypass, persistence, and service/listener/database sentinels.
- Required validation is green with project-pinned `corepack pnpm`.

Not verified yet:

- Real producer diagnostics from live/internal runs have not been measured as a corpus.
- Real operator actionability and noise rates have not been proven outside the synthetic sample matrix.
- P95/P99 collector latency over realistic mixed diagnostic volumes has not been measured.
- Repeated-run stability across different runtime sessions has not been proven.
- Raw diagnostic leakage/privacy redaction has not been audited against real producer payloads.
- No operator-facing UI or persistence semantics have been designed or approved.
- No default-on or production authority migration has been approved.

## Boundary Scan Evidence

Focused scans from this diagnosis:

- `rg -n "collectRuntimeRegistryDiagnostics\\(" openclaw_runtime/src electron src shared --glob "!**/*.test.ts" --glob "!**/*.test.tsx" --glob "!**/test-support*"` matched only `openclaw_runtime/src/runtime-core/registries.ts`, confirming no active production consumer call exists.
- `rg -n "registryDiagnostics:\\s*\\{\\s*collector:\\s*true|registryPilot:\\s*\\{\\s*enabled:\\s*true|providerRegistry:\\s*\\{\\s*shadow:\\s*true|contextProviders:\\s*\\{[^}]*registryPilot:\\s*true|toolRegistry:\\s*\\{\\s*shadow:\\s*true" openclaw_runtime/src electron src shared --glob "!**/*.test.ts" --glob "!**/*.test.tsx" --glob "!**/test-support*"` returned no matches, confirming no production default-on registry flags in the scanned source set.
- `runtimeRegistryDiagnosticShadowEnabled()` in `openclaw_runtime/src/agents/task-loop-controller.ts` still requires `registryDiagnosticsCollector` plus the explicit surface gates before registry diagnostics can attach as shadow metadata.
- `rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components` returned no matches.

## Recommended Next Slice

Create a Registry-only real-producer validation slice, not a boundary expansion slice.

Suggested task spec:

`harness/specs/tasks/phase-3-provider-tool-registry-real-producer-diagnostic-consumer-validation.md`

Purpose:

- Feed the consumer from existing real producer seams in memory: context-provider registry pilot output, MCP/tool-provider registry shadow output, and TaskLoop injected registry diagnostics.
- Keep all diagnostics caller-owned, in-memory, default-off, and non-authoritative.
- Measure actionability/noise, omitted diagnostics, latency, fail-closed behavior, raw leakage, and drift using producer-generated diagnostics instead of hand-authored diagnostics.

Required gates:

- At least 30 producer-generated diagnostics across context, tool, and TaskLoop injected shadow paths.
- `provider_ordering_drift = 0`.
- `legacy_behavior_drift = 0`.
- `renderer_bypass = 0`.
- `persistence_matches = 0`.
- `service_listener_database_matches = 0`.
- `raw_payload_leakage = 0`.
- `fail_closed_rate = 100%`.
- `actionable_rate > noise_rate`.
- Explicit omitted diagnostic count for every over-limit case.
- No production `collectRuntimeRegistryDiagnostics()` call outside an explicit test/in-memory validation seam.

## Expansion Criteria

Only consider expanding the boundary after the real-producer validation slice passes.

Expansion can mean an internal opt-in diagnostic consumer contract, still default-off and non-persistent. It must not mean default-on behavior, provider ordering authority, TaskLoop authority, completion evidence, prompt/model-message changes, Gateway/provider transport changes, persistence, UI, services/listeners/databases, or renderer bypass.

## Stop Conditions

Keep tightening instead of expanding if any of these happen:

- Real producer actionability is less than or equal to noise.
- Diagnostics require changing MCP response shape, approval/retry/error semantics, prompts/model messages, provider transport, or TaskLoop authority to be useful.
- Raw producer payloads leak secrets, untrusted traces, large content, or user data into diagnostic summaries.
- Omitted diagnostics are not explicitly counted.
- Collector latency exceeds the agreed bounded envelope under realistic mixed inputs.
- Any default-on, persistence, renderer bypass, service/listener/database, or provider ordering drift appears.

## Next Work Plan

1. Add the real-producer validation task spec above.
2. Add a focused unit/integration test that uses existing producer functions to generate diagnostics, then consumes them through the collector in memory.
3. Add raw-leakage and over-limit cases generated from producer-like payloads, not handwritten collector inputs.
4. Keep TaskLoop assertions focused on unchanged lifecycle/final-status/self-check/checkpoint behavior.
5. Rerun harness context/validate, focused producer validation test, existing registry/context/tool/MCP/TaskLoop/readiness suites, typecheck, and boundary scans.
6. Update synthesis only after producer-generated evidence passes.
