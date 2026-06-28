# Lane A AgentMap Real-Repo Hardening

## Scope

Hardened AgentMap readonly result building for real repository inputs without wiring it into default runtime behavior. The work stays inside `openclaw_runtime/src/runtime-core/agent-map.ts` plus focused unit coverage in `tests/unit/runtime-agent-map-hardening.test.ts`.

## Implementation Evidence

- `openclaw_runtime/src/runtime-core/agent-map.ts`
  - Added `AgentMapInputLimits` and `AGENT_MAP_DEFAULT_INPUT_LIMITS` with max files, max file bytes, and common ignored directories.
  - Added closed diagnostic contracts via `AgentMapDiagnosticCode`, `AgentMapDiagnosticSeverity`, `AgentMapDiagnostic`, `isAgentMapDiagnostic()`, and optional `AgentMapResult.diagnostics`.
  - Added pre-extraction filtering for ignored directories, unsupported extensions, oversized files, binary-looking content, generated file names/directories/headers, and max-file overflow.
  - Added parse/extraction failure isolation so one bad file returns `parse_failure` diagnostics while other files still rank/render.
  - Added diagnostic evidence metadata and diagnostic `excludedFiles` entries with `reason: "diagnostic"`.
  - Kept ranking, rendering, cache usage, provider registration, TaskLoop, Gateway, prompt assembly, and direct discovery tools untouched.
- `tests/unit/runtime-agent-map-hardening.test.ts`
  - Covers large-file skip, ignored-directory skip, max-files enforcement, binary/generated/unsupported skip, single-file parse failure isolation, structured empty candidate status, and readonly/result schema validity.

## Boundary Evidence

- No renderer/Main, Gateway, provider transport, TaskLoop, provider registry, or prompt assembly path was touched.
- No default AgentMap provider behavior was added or enabled.
- No direct `read`, `grep`, `find`, or `ls` behavior was wrapped, replaced, disabled, or discouraged.
- No mutation/apply/edit surface was added.
- No service, daemon, listener, HTTP server, WebSocket server, or external database was added.
- Docs-sync review: this is internal AgentMap readiness hardening and does not change user-facing README behavior/flows/interfaces, so README translation updates are not required.
- Comms replay/compare were not required because no gateway events, runtime send/receive, channel delivery, fallback transport, host-api, api-client, or renderer/Main communication paths were touched.

## Verification

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md`
  - Produced the expected runtime-use readiness reading list.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md`
  - Spec valid.
- `pnpm --config.verify-deps-before-run=false harness run --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md --dry-run`
  - Harness report passed: `artifacts/harness/latest.md`.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-contracts.test.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts tests/unit/runtime-agent-map-budget.test.ts tests/unit/runtime-agent-map-hardening.test.ts`
  - 5 files passed, 18 tests passed.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-cache.test.ts`
  - 1 file passed, 3 tests passed.
- `pnpm --config.verify-deps-before-run=false run typecheck`
  - `typecheck:node` and `typecheck:web` passed.
- `rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(' openclaw_runtime/src/runtime-core/agent-map.ts tests/unit/runtime-agent-map-hardening.test.ts`
  - No matches.
- `rg -n 'rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply' openclaw_runtime/src/runtime-core/agent-map.ts tests/unit/runtime-agent-map-hardening.test.ts`
  - No matches.

Status: accepted
