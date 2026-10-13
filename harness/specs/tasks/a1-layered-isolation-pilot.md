---
lifecycleStatus: archived
id: a1-layered-isolation-pilot
title: A1 Layered Execution Isolation — Active Pilot Gate
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Promote the A1 shadow isolation path from shadow to active pilot, gated by graduation metrics and budget compliance.
touchedAreas:
  - openclaw_runtime/src/observability/deprecation-counters.ts
  - openclaw_runtime/src/agents/sessions/extensions/policy-light-snapshotter.ts
  - openclaw_runtime/src/agents/sessions/extensions/shadow-write-event-recorder.ts
  - openclaw_runtime/src/shared/tool-registration.ts
  - openclaw_runtime/src/observability/trace-recorder.ts
  - openclaw_runtime/src/observability/namespace-governance.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
expectedUserBehavior:
  - With the A1 pilot gate enabled, tool calls are served by the layered isolation path and the legacy fallback counter stays under the 5% graduation budget.
  - Every built-in write-capable tool (write/edit/bash/apply_patch/exec/process) declares its `writeRiskProfile` and `risk`, so the registry rejects an undeclared write instead of running it.
  - A trace written under the wrong namespace (for example `claw.a4.tool.choice` on an A1 recorder) is rejected rather than silently recorded.
  - The shadow write-event recorder flags tools that write outside their `declared_paths`/`no_writes` contract.
  - When the fallback rate exceeds 5%, the pilot responds with `degrade_to_legacy` instead of continuing to serve the isolated path.
  - With the pilot flag off, tool execution, tracing, and write behaviour are unchanged.
requiredTests:
  - tests/unit/tool-registration.test.ts
  - tests/unit/policy-light-snapshotter.test.ts
  - tests/unit/shadow-write-event-recorder.test.ts
  - tests/unit/trace-namespace-enforcement.test.ts
  - tests/unit/performance-budgets.test.ts
  - tests/unit/deprecation-counters.test.ts
  - openclaw_runtime/src/observability/deprecation-counters.test.ts
acceptance:
  - A1 deprecation counter `legacyFallbackCount` rate < 5% over 100-turn session
  - A1 p99 ≤ 200ms (criterion 4.5)
  - All 6 built-in tools (write/edit/bash/apply_patch/exec/process) declare `writeRiskProfile` + `risk`
  - Plugin registry enforces `assertWriteRiskProfileForTool` on `registerTool`
  - Trace namespace enforced: `claw.a4.tool.choice` on an a1 recorder is rejected
  - Shadow write event recorder detects undeclared writes for `declared_paths`/`no_writes` tools
  - Budget violation response `degrade_to_legacy` triggers when fallback rate > 5%
docs:
  required: true
---

## Graduation gate

A1 graduates from shadow to active pilot when ALL of the following hold:

1. **Legacy fallback rate** < 5%: `legacyFallbackCount / (legacyFallbackCount + shadowSuccessCount) < 0.05` over a 100-turn session.
2. **Performance**: p99 ≤ 200ms for the isolation hot path (criterion 4.5).
3. **No critical violations**: `declaredPathViolationCount` is decreasing trend over 3 sessions.
4. **Budget violation response works**: `checkBudgetViolation('a1')` returns `degrade_to_legacy` when rate > 5% (criterion 4.14).

## Out of scope

- Replacing `IsolationFailureRecovery` legacy path — only deprecation, not removal.
- `dynamic_writes` heuristic detection (OQ-008).
- Per-tool path-prefix allow-lists (future enhancement).
