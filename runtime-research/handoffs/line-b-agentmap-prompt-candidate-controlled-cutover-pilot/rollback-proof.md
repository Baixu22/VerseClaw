# Rollback Proof

Rollback is gate-based and requires no cleanup.

| Closed Gate | Expected Result |
|---|---|
| `runtime.agentMap.promptAssemblyExperiment !== true` | Return legacy prompt bytes; emit disabled diagnostic. |
| `runtime.agentMap.promptCandidateRuntimeShadow !== true` | Return legacy prompt bytes; emit disabled diagnostic. |
| `runtime.agentMap.promptCandidateControlledCutoverPilot !== true` | Return legacy prompt bytes; emit disabled diagnostic. |
| Missing/invalid `AgentMapResult` | Return legacy prompt bytes; emit explicit-input diagnostic. |
| Budget exhausted | Return legacy prompt bytes; emit budget diagnostic. |
| Prompt-present exclusion leaves no eligible symbols | Return legacy prompt bytes; emit prompt-present/empty diagnostics. |

Candidate output is memory-only and returned to the caller. The pilot does not write files, append logs, create stores, use localStorage/indexedDB/electron-store, or open SQLite/Postgres/MySQL/Redis.
