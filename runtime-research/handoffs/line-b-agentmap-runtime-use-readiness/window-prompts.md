# Line B AgentMap Runtime-Use Readiness Window Prompts

Use these prompts for future windows. They preserve default-off, readonly/shadow boundaries and do not authorize runtime cutover.

## Lane A Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Line B runtime-use readiness Lane A: real repository fixtures and ranking hardening.

Goal:
Harden AgentMap fixture coverage and deterministic ranking evidence for future runtime-use readiness. Do not implement runtime cutover, default provider registration, TaskLoop/Gateway integration, provider ordering changes, prompt assembly cutover, read/grep/find/ls replacement, or patch/edit/apply behavior.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md and use rtk if available; if unavailable, record the fallback.
- Read harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md.
- Read runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/README.md.
- Read runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/parallel-lanes.md.
- Read runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/synthesis.md.
- Read openclaw_runtime/src/runtime-core/agent-map.ts.
- Read tests/unit/runtime-agent-map-*.test.ts.

Boundary:
- readonly only.
- AgentMap remains default-off and non-authoritative.
- No default-on behavior.
- No TaskLoop/Gateway/provider ordering/default prompt cutover.
- No read/grep/find/ls replacement.
- No AST patch apply, symbol edit apply, or workspace edit.
- No new service/listener/daemon/external database.

Suggested files:
- openclaw_runtime/src/runtime-core/agent-map.ts
- tests/unit/runtime-agent-map-ranking.test.ts
- tests/unit/runtime-agent-map-renderer.test.ts
- tests/fixtures/agent-map/**

Required evidence:
- Deterministic real repository fixture output.
- Active file references lift related definitions.
- Mentioned identifiers and path components lift matching symbols.
- Prompt-present files are excluded or marked without prompt authority.
- Stable tie breaks are visible and tested.
- Boundary scans prove forbidden changes did not land.

Write:
runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/submissions/line-b-runtime-a-fixtures-ranking-hardening.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked
```

## Lane B Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Line B runtime-use readiness Lane B: performance budget, cache, and error isolation.

Goal:
Add runtime-use readiness evidence for AgentMap performance budgets, cache invalidation if caching is implemented, and structured error isolation. Do not add a service, listener, daemon, always-on indexer, external database, runtime cutover, prompt cutover, or mutation/apply/edit behavior.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md and use rtk if available; if unavailable, record the fallback.
- Read harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md.
- Read runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/README.md.
- Read runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/parallel-lanes.md.
- Read openclaw_runtime/src/runtime-core/agent-map.ts.
- Read tests/unit/runtime-agent-map-budget.test.ts.
- Read tests/fixtures/agent-map/**.

Boundary:
- local in-process hardening only.
- Explicit diagnostics, not runtime authority.
- No default-on provider behavior.
- No TaskLoop/Gateway/provider ordering/default prompt cutover.
- No read/grep/find/ls replacement.
- No AST patch apply, symbol edit apply, or workspace edit.
- No new service/listener/daemon/external database.

Suggested files:
- openclaw_runtime/src/runtime-core/agent-map.ts
- tests/unit/runtime-agent-map-budget.test.ts
- tests/unit/runtime-agent-map-cache.test.ts
- tests/unit/runtime-agent-map-errors.test.ts
- tests/fixtures/agent-map/**

Required evidence:
- Performance budget command and threshold.
- Budget fitting stays monotonic and does not truncate symbol blocks.
- Cache invalidates on file content/hash/mtime, request inputs, config, and token budget changes if caching is implemented.
- Extraction/render/cache/provider failures return structured diagnostics.
- Boundary scans prove no service/listener/daemon/database or mutation/apply/edit behavior.

Write:
runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/submissions/line-b-runtime-b-performance-cache-errors.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked
```

## Lane C Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Line B runtime-use readiness Lane C: default-off provider diagnostics.

Goal:
Harden AgentMap opt-in/shadow provider diagnostics while preserving default provider ordering and legacy authority. Do not make AgentMap default-on or feed it into TaskLoop, Gateway, chat, model messages, provider ordering, or default prompt assembly.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md and use rtk if available; if unavailable, record the fallback.
- Read harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md.
- Read runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/README.md.
- Read runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/parallel-lanes.md.
- Read runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-d-context-provider-shadow-boundary.md.
- Read openclaw_runtime/src/context-engine/agent-map-context-provider.ts.
- Read openclaw_runtime/src/context-engine/provider-registry.ts.
- Read tests/unit/runtime-agent-map-context-provider.test.ts.
- Read tests/unit/context-provider-registry.test.ts.

Boundary:
- explicit opt-in/default-off provider only.
- diagnostics/evidence only.
- Legacy context remains authoritative.
- No default provider registration or ordering cutover.
- No TaskLoop/Gateway/default prompt cutover.
- No read/grep/find/ls replacement.
- No mutation/apply/edit behavior.

Suggested files:
- openclaw_runtime/src/context-engine/agent-map-context-provider.ts
- openclaw_runtime/src/context-engine/provider-registry.ts
- tests/unit/runtime-agent-map-context-provider.test.ts
- tests/unit/context-provider-registry.test.ts

Required evidence:
- No-arg default registry ordering remains unchanged.
- AgentMap provider remains enabledByDefault false and shadowOnly true.
- Opt-in provider emits noPromptAuthority, noToolAuthority, and noRuntimeAuthority metadata.
- Provider failures are isolated as diagnostics.
- Boundary scans prove no renderer/Main/Gateway bypass or cutover.

Write:
runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/submissions/line-b-runtime-c-provider-opt-in-diagnostics.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked
```

## Lane D Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Line B runtime-use readiness Lane D: validation and synthesis.

Prerequisite:
Only continue when Lane A-C submissions exist. If any are missing, stop and report missing submissions.

Goal:
Validate AgentMap runtime-use readiness evidence without accepting runtime cutover. Re-verify claims; do not accept unproven lane text.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md and use rtk if available; if unavailable, record the fallback.
- Read harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md.
- Read runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/README.md.
- Read runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/parallel-lanes.md.
- Read all Lane A-C submissions.
- Read touched source and test files.

Required checks:
- Confirm A-C each has exactly one valid Status line.
- Reclassify A-C as accepted / needs_revision / blocked.
- Run harness context/validate for phase-line-b-agentmap-runtime-use-readiness.
- Run focused AgentMap and context-provider tests touched by A-C.
- Run typecheck if runtime source changed.
- Run renderer IPC/Gateway bypass scan if renderer/Main paths changed.
- Run service/listener/daemon/database scan over touched files.
- Run mutation/apply/edit scan over touched files.
- Run comms replay/compare only if Main/Gateway/host-api/api-client/provider transport paths changed.

Write:
runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/submissions/line-b-runtime-d-validation-synthesis.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked
```
