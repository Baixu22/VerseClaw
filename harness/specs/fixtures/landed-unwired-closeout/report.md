# Landed-Unwired Final Audit

- Generated at: 2026-10-20T17:19:43.731Z
- Driven by: agent (codex)
- Total entries: 22
- Wired: 22
- Pending-wiring: 0
- Missing executor: 0
- True unwired count: 0

| ID | Wave | Kind | Risk | Executor | Sites |
|---|---|---|---|---|---|
| context-view-tools | C1 | env | opt-in | wired | `openclaw_runtime/src/agents/tools/context-agent-tools.ts:267` |
| context-tools-alias | C1 | env | opt-in | wired | `openclaw_runtime/src/context-engine/dcs-context-tools-flags.ts:30` |
| working-memory | DCS-S1 | config | opt-in | wired | `openclaw_runtime/src/context-engine/assembler.ts:479` |
| tool-registry | DCS-S3 | config | opt-in | wired | `openclaw_runtime/src/context-engine/assembler.ts:490` |
| stale-write-guard | C2 | config | opt-in | wired | `openclaw_runtime/src/agents/agent-tools.ts:885` |
| write-journal | C2 | info | baseline-on | wired | `openclaw_runtime/src/agents/agent-tools.ts:876` |
| worktree-backend | C4 | api | api-only | wired | `openclaw_runtime/src/agents/orchestrator-run-observed.ts:435` |
| isolation-request | C4 | request | request-only | wired | `openclaw_runtime/src/agents/orchestrator.ts:207` |
| symbol-lease | C5 | config | opt-in | wired | `openclaw_runtime/src/agents/agent-tools.ts:867` |
| symbol-lease-mode | C5 | config | opt-in | wired | `openclaw_runtime/src/agents/agent-tools.ts:871` |
| patch-flow | C5 | api | api-only | wired | `openclaw_runtime/src/agents/orchestrator.ts:547`, `openclaw_runtime/src/agents/orchestrator.ts:557`, `openclaw_runtime/src/agents/orchestrator-run-observed.ts:736`, `openclaw_runtime/src/agents/subagent-registry.ts:612` |
| context-ladder | C6 | api | api-only | wired | `openclaw_runtime/src/context-engine/assembler.ts:384`, `openclaw_runtime/src/context-engine/assembler.ts:393` |
| routing-memo-shadow | C7 | config | shadow-only | wired | `openclaw_runtime/src/agents/agent-tools.before-tool-call.ts:1349` |
| sekb-experience-shadow | C7 | api | api-only | wired | `electron/services/knowledge-api.ts:5483`, `electron/services/knowledge-api.ts:5496` |
| sekb-retrieval-shadow | KE-P1 | config | shadow-only | wired | `openclaw_runtime/src/knowledge/sekb/retrieval-engine.ts:97` |
| runtime-memory-persist | R3 | config | opt-in | wired | `openclaw_runtime/src/runtime-core/memory-persistence.ts:518` |
| runtime-memory-inject-pilot | R3 | config | opt-in | wired | `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:2144`, `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:2160` |
| runtime-memory-candidate-generation | KE-P1 | config | opt-in | wired | `openclaw_runtime/src/runtime-core/ke-candidate-generation.ts:254` |
| compass-context-block | R3 | config | read-only | wired | `openclaw_runtime/src/context-engine/assembler.ts:755` |
| role-memory | R3 | config | read-only | wired | `openclaw_runtime/src/context-engine/assembler.ts:758` |
| verseshell-patch-preview | VS-P3 | config | read-only | wired | `openclaw_runtime/src/agents/agent-tools.ts:1224`, `openclaw_runtime/src/agents/agent-tools.ts:1354` |
| rc03-seal | RC-03 | config | opt-in | wired | `openclaw_runtime/src/context-engine/context-orchestrator.ts:376` |

