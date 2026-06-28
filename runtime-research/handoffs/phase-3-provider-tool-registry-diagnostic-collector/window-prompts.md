# Phase 3 Provider Tool Registry Diagnostic Collector Window Prompts

Use these prompts to run a one-conversation MVP implementation under Goal mode. The MVP is a shadow-only follow-up to the accepted Phase 3 registry pilot. It may collect diagnostics and feed shadow metadata, but it must not change provider ordering, tool authority, prompts, approvals, Gateway payloads, or TaskLoop status.

## Goal Prompt

```text
Goal: Implement the Phase 3 Provider Tool Registry Diagnostic Collector MVP end to end in one conversation.

Required reading first:
- AGENTS.md
- runtime-research/agent-runtime-index.md
- runtime-research/implementation-roadmap.md
- runtime-research/migration-execution-plan.md
- runtime-research/agent-runtime-core-spec.md
- runtime-research/handoffs/phase-3-provider-tool-registry-pilot/synthesis.md
- runtime-research/handoffs/phase-3-provider-tool-registry-pilot/parallel-lanes.md
- runtime-research/continue/providers.md
- runtime-research/continue/tool-provider.md
- runtime-research/continue/useful-tests.md
- harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md
- runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/README.md
- runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/parallel-lanes.md
- runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submission-template.md
- runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/synthesis.md

Run before implementation:
- pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md
- pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md --no-diff

MVP target:
- Add a runtime-owned registry diagnostic collector contract/helper.
- Merge accepted context-provider registry diagnostics and tool-provider registry diagnostics into bounded shadow output.
- Keep all collector flags/defaults off by omission.
- Expand tool-provider diagnostics for unsupported MCP content, provider exceptions, denied/waiting/cancelled outcomes, and normalized error categories.
- Add one non-MCP built-in tool diagnostic shape only if an existing safe adapter seam is already present; otherwise document not-run/not-available without inventing a new transport.
- Feed TaskLoop only through explicit injected runtimeRegistryDiagnostics or successor shadow seam.
- Preserve legacy prompt text, provider ordering, MCP response shape, approval semantics, TaskLoop final status, self-check, lifecycle payload authority, checkpoint authority, Gateway/model/provider payloads.
- Write A-E lane submissions and update synthesis only if evidence passes.
- Update runtime-research/agent-runtime-index.md only after accepted synthesis.

Hard boundaries:
- No provider ordering cutover, default provider registration, automatic provider enablement, default-on registry behavior, tool authority, TaskLoop authority, prompt/model-message insertion, Gateway/provider transport changes, persistence, renderer IPC/Gateway bypass, service/listener/daemon, or external database.

Primary files likely to touch:
- openclaw_runtime/src/runtime-core/registries.ts or a small adjacent runtime-core diagnostics module
- openclaw_runtime/src/context-engine/provider-registry.ts
- electron/services/tool-provider-registry.ts
- electron/services/mcp-api.ts only if needed for existing shadow diagnostics
- openclaw_runtime/src/agents/task-loop-controller.ts only through existing shadow diagnostics injection
- tests/unit/runtime-provider-tool-registry*.test.ts
- tests/unit/context-provider-registry.test.ts
- tests/unit/tool-provider-registry.test.ts
- tests/unit/mcp-api.test.ts
- tests/unit/task-loop-controller.test.ts

Do not broaden implementation into default registry cutover. This is a collector and diagnostics MVP, nothing more.
```

## One-Conversation MVP Implementation Prompt

```text
Implement Phase 3 Provider Tool Registry Diagnostic Collector MVP.

Work in this order:
1. Read required docs and run harness context/structural validate.
2. Inspect accepted Phase 3 registry contracts, context provider registry pilot, tool provider registry, MCP API tests, and TaskLoop runtimeRegistryDiagnostics seam.
3. Design a small collector surface:
   - RuntimeRegistryDiagnosticInput
   - RuntimeRegistryDiagnosticRecord
   - RuntimeRegistryDiagnosticCollectorResult
   - collector feature flag resolver
   - merge/sanitize/bound helper
4. Implement collector as explicit-call runtime-owned helper.
5. Context side:
   - collect existing context registry diagnostics only when explicit flags/options are on;
   - prove default provider ordering and prompt/message output do not change.
6. Tool side:
   - normalize unsupported MCP content, provider exceptions, denied/waiting/cancelled outcomes, and errors into diagnostics;
   - preserve legacy MCP result shape;
   - add a non-MCP built-in diagnostic shape only from an existing safe seam, else document as not available for MVP.
7. TaskLoop side:
   - pass collected diagnostics only through explicit injection;
   - emit only shadow metadata/evidence refs when existing TaskLoop shadow gates are enabled;
   - prove final status, lifecycle payload authority, self-check, checkpoint authority, reviewer prompts, model/Gateway/provider payloads are unchanged.
8. Add tests:
   - flags disabled no-op
   - bounded merge/sanitize
   - context provider exception/unknown provider diagnostics
   - unsupported MCP content
   - provider thrown exception
   - denied/waiting/cancelled outcome
   - legacy MCP shape parity
   - TaskLoop shadow-only bridge
   - no default provider ordering drift
9. Run focused tests, typecheck, renderer/service boundary scans, comms replay/compare.
10. Fill lane submissions A-E with evidence.
11. Update synthesis from needs_revision to accepted only if all gates pass.
12. Update agent-runtime-index.md only after accepted synthesis.

Final answer must include:
- files changed
- tests/commands run and result
- comms replay/compare result or justified blocker
- validation blocked by unrelated dirty worktree if applicable
- explicit confirmation that no provider-ordering/tool-authority/TaskLoop-authority path was added
```

## Lane A Prompt: Collector Contracts And Flags

```text
Implement Lane A for Phase 3 Provider Tool Registry Diagnostic Collector.

Scope:
- Define runtime-owned collector contracts and diagnostic record shape.
- Add default-off collector flag resolution.
- Add bounded merge/sanitize helper for context/tool diagnostic records.
- Do not wire collector into live context, tool, or TaskLoop paths.
- Do not alter accepted Phase 3 contract behavior.

Acceptance:
- Tests cover disabled flags, bounded output, diagnostic sanitization, stable ordering, and source surface metadata.
- No provider ordering or tool authority code is added.
- Submission file:
  runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/lane-a-collector-contracts-and-flags.md
```

## Lane B Prompt: Context Provider Diagnostics Collector

```text
Implement Lane B for Phase 3 Provider Tool Registry Diagnostic Collector.

Scope:
- Collect diagnostics from existing context provider registry pilot surfaces.
- Preserve prompt/message parity and default provider ordering.
- Cover disabled flags, unknown provider, provider exception, empty output, and bounded diagnostic output.
- Keep provider outputs non-authoritative.

Acceptance:
- Tests prove default registry ordering is unchanged.
- Tests prove prompt/message output parity with flags off and shadow diagnostics enabled.
- Diagnostics are emitted only when explicit collector/registry flags are on.
- Submission file:
  runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/lane-b-context-provider-diagnostics-collector.md
```

## Lane C Prompt: Tool Provider Diagnostics Expansion

```text
Implement Lane C for Phase 3 Provider Tool Registry Diagnostic Collector.

Scope:
- Extend tool-provider shadow diagnostics for:
  - unsupported MCP content
  - provider thrown exception
  - denied outcome
  - permission waiting outcome
  - cancelled outcome
  - normalized provider error category
- Preserve legacy MCP callTool response shape and approval semantics.
- Add one non-MCP built-in diagnostic shape only if a safe existing adapter seam is present.
- Do not expose new visible tools or change tool execution.

Acceptance:
- Tests prove MCP return shape parity.
- Tests cover unsupported content, thrown exception, denied, waiting, cancelled, and normalized error diagnostics.
- Comms replay/compare is run because Electron/Main tool service paths may be touched.
- Submission file:
  runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/lane-c-tool-provider-diagnostics-expansion.md
```

## Lane D Prompt: TaskLoop Shadow Diagnostics Bridge

```text
Implement Lane D for Phase 3 Provider Tool Registry Diagnostic Collector.

Scope:
- Inject collected diagnostics into TaskLoop through existing runtimeRegistryDiagnostics or a narrow successor seam.
- Emit diagnostics only as shadow metadata/evidence refs.
- Require existing TaskLoop shadow gates plus registry collector flags.
- Preserve final status, lifecycle payload authority, self-check authority, checkpoint authority, reviewer prompts, model messages, Gateway payloads, and provider transport.

Acceptance:
- Tests cover flag-off no-op.
- Tests cover flag-on shadow metadata/evidence only.
- Tests prove TaskLoop final status and legacy payloads are unchanged.
- Search proves diagnostics do not enter reviewer prompts/model/Gateway/provider payloads.
- Submission file:
  runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/lane-d-taskloop-shadow-diagnostics-bridge.md
```

## Lane E Prompt: Validation Comms Synthesis

```text
Run Lane E validation for Phase 3 Provider Tool Registry Diagnostic Collector.

Required:
- Validate task spec with --no-diff and record normal validate result. If normal validate fails because of unrelated dirty files, classify and quote that.
- Run focused unit tests:
  - runtime-provider-tool-registry*.test.ts
  - context-provider-registry.test.ts
  - tool-provider-registry.test.ts
  - mcp-api.test.ts
  - task-loop-controller.test.ts
- Run typecheck if feasible.
- Run comms replay/compare if Electron/Main/Gateway service paths changed.
- Run boundary scans:
  - renderer direct IPC/Gateway bypass
  - service/listener/daemon/database additions
  - provider ordering/default registration/default-on claims
  - prompt/model/Gateway/provider payload insertion
  - persistence/write sinks for diagnostics
- Verify every lane submission has exactly one Status line.
- Update synthesis to accepted only if A-D evidence and boundary scans pass.
- Update agent-runtime-index.md only after accepted synthesis.

Submission file:
runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/lane-e-validation-comms-synthesis.md
```

## Synthesis Prompt

```text
Synthesize Phase 3 Provider Tool Registry Diagnostic Collector.

Read A-E submissions, tests, commands, touched files, and boundary scans.

Classify each lane as accepted, needs_revision, or blocked.

Accept only if:
- collector contracts exist and are explicit-call/default-off;
- diagnostics are bounded, sanitized, stable, and non-authoritative;
- context diagnostics preserve provider ordering and prompt/message parity;
- tool diagnostics preserve MCP result shape, approval/waiting semantics, retries, and error mapping;
- TaskLoop receives diagnostics only through shadow metadata/evidence refs;
- no final status, self-check, lifecycle authority, checkpoint authority, reviewer prompt, model message, Gateway request, provider transport, or provider ordering changes occur;
- focused tests pass;
- comms replay/compare passes if relevant paths changed;
- task spec validates structurally;
- normal validate is either pass or blocked only by unrelated dirty files and clearly recorded.

If accepted:
- Change synthesis status to `Status: accepted`.
- Update agent-runtime-index.md Provider/Tool Registry next/status with code/tests/handoff.

If any gate fails:
- Keep `Status: needs_revision` and list exact required fixes.
```

## MVP Acceptance Matrix

| Gate | Required Result |
|---|---|
| Spec context | `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md` passes |
| Spec structural validate | `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md --no-diff` passes |
| Focused tests | Registry/context/tool/MCP/TaskLoop focused tests pass |
| Typecheck | Passes, or unrelated existing failures are documented with exact paths |
| Comms | `pnpm run comms:replay` and `pnpm run comms:compare` pass if Main/Gateway paths changed |
| Provider ordering | Tests/scans prove no default provider registration or ordering cutover |
| Tool behavior | Tests prove MCP response shape and approval semantics unchanged |
| TaskLoop authority | Tests prove final status, lifecycle authority, self-check, checkpoint authority, prompts, and payloads unchanged |
| No transport bypass | Renderer IPC/Gateway scans pass |
| No service/persistence | Touched-file scans pass |
| Lane submissions | A-E exist and each has exactly one Status line |
| Synthesis | Accepted only after evidence passes |
| Index | Updated only after accepted synthesis |

## Failure Handling

- If MCP result shape changes, reject the MVP.
- If provider ordering or default registration changes, reject the MVP.
- If TaskLoop final status/self-check/checkpoint/reviewer prompt/model/Gateway/provider payload changes, reject the MVP.
- If diagnostics are persisted outside explicit test-owned/in-memory sinks, reject the MVP.
- If normal harness validate fails because of unrelated dirty files, record it as blocked-by-dirty-worktree but require `--no-diff` structural validate to pass.
