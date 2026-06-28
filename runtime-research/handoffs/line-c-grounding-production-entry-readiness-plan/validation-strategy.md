# Line C Grounding Production-entry Validation Strategy

The validation strategy proves planning completeness and boundary preservation. It does not prove production runtime authority.

## Required Validation Matrix

| Gate | Command or evidence | Expected result |
| --- | --- | --- |
| New spec context | `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md` | Pass. |
| New spec validation | `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md` | Pass, or blocked only by unrelated dirty worktree state with reason recorded. |
| New spec structural validation | `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md --no-diff` | Pass if normal validation is blocked by unrelated dirty state. |
| Predecessor readiness validation | `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-readiness.md --no-diff` | Pass. |
| Authority-sentinel validation | `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-effectiveness-evaluation.md --no-diff` | Pass. |
| Grounding diagnostics unit tests | `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts` | Pass. |
| TypeScript node check | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | Pass or unrelated blocker recorded. |
| Diff whitespace | `git diff --check -- <touched-files>` | Pass. |
| README review | Focused scan and manual review of `README.md`, `README.zh-CN.md`, `README.ja-JP.md`. | No update required unless user-visible behavior/API/UI/settings/commands changed. |
| Comms decision | Review touched paths for Main/Gateway/host-api/api-client/provider transport/gateway events/runtime send-receive/delivery/fallback. | Run comms replay/compare only if such paths are touched; otherwise record skip reason. |

## Boundary Scans

| Boundary | Scan intent |
| --- | --- |
| Transport boundary | Detect renderer direct IPC, direct Gateway HTTP/WebSocket, `gateway:httpProxy`, or `hostapi:fetch` changes. |
| Service/persistence creep | Detect servers, listeners, exporters, databases, sidecars, write streams, and file writes in touched files. |
| Raw retention | Detect raw prompt, raw trace, full payload, tool args/output, stdout/stderr, env, secrets, API keys, auth headers, trace-context baggage, transcripts, and JSONL retention language. |
| Authority drift | Detect authority-grant fields, truthy authority language, or runtime/completion/provider/prompt/memory/persistence mutation authority. |
| Memory mutation | Detect promotion, fact acceptance, episode write, memory store write, invalidation acceptance, persistence, save, and upsert language. |
| Patch/workspace mutation | Detect patch apply, workspace edit, rename, replace, insert, safe delete, symbol apply, and ast-grep apply language. |

Expected scan result for this planning phase: matches are limited to spec/report policy text, rejected-boundary text, existing owner surfaces, or pre-existing unrelated worktree changes.

## Future Phase Validation Additions

| Phase | Additional validation required |
| --- | --- |
| Phase A | Pilot cohort opt-in audit, disabled parity, explicit activation, rollback drill. |
| Phase B | Redaction tests, aggregate display tests, i18n and Electron E2E if UI is accepted. |
| Phase C | Production-like sampling metrics, budget/token/p95 overhead, privacy/security review, rollback time objective. |
| Phase D | Deterministic replay, sanitized corpus proof, provider ordering snapshots, no-residue replay scan. |
| Phase E | Evidence audit, scorecard, owner approvals, veto gate review. |
| Phase F | Controlled production opt-in metrics, comms/E2E/i18n if touched, rollback drill. |
| Phase G | Proposal-only completeness review and explicit non-implementation validation. |
