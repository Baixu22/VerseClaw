# Line C Grounding Spine Impl Lane A Contracts

## Scope

- Added `openclaw_runtime/src/runtime-core/grounding.ts` with readonly derived GroundingRef / GroundingQuery contracts, guards, fixtures, and bounded sanitizers.
- Added `export * from "./grounding.js";` to `openclaw_runtime/src/runtime-core/index.ts`.
- Added `tests/unit/runtime-grounding-contracts.test.ts` for the Lane A contract surface.

This lane did not implement projection/query from real runtime surfaces and did not touch TaskLoop, Gateway, runtime execution, provider ordering, completion, retry, permission, or security authority.

## Contract Notes

- `GroundingRefAuthority` is fixed to `"none"` through `GROUNDING_REF_AUTHORITY`.
- Every fixture ref has top-level `rawRetained: false`, `projection.rawRetained: false`, and `sanitization.rawRetained: false`.
- `GroundingRefTrust` accepts only `verified`, `supplied`, `projected`, and `untrusted`.
- `GroundingQuery.includeRaw` accepts only `false` or `undefined`; the sanitizer normalizes any provided value to `false`.
- `GroundingResult` is bounded, summary-only, and requires `readonly: true`.
- Grounding metadata uses a stricter JSON guard than generic record checks, so non-JSON values such as `Date`, `Map`, functions, and `undefined` fields are rejected by the guards and omitted by sanitizers.

## Validation

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-contracts.test.ts` | pass, 1 file / 9 tests |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| `rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components --glob "!**/*.md"` | no matches |
| `rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\\(|daemon|listener|service|database|sqlite|postgres|mysql|redis|sidecar" openclaw_runtime/src/runtime-core/grounding.ts openclaw_runtime/src/runtime-core/index.ts tests/unit/runtime-grounding-contracts.test.ts` | no matches |
| `rg -n "writeFile|appendFile|createWriteStream|mkdir|\\.jsonl|\\.sqlite|sqlite|kysely|better-sqlite3|database|persist|cache|store|sidecar" openclaw_runtime/src/runtime-core/grounding.ts tests/unit/runtime-grounding-contracts.test.ts` | no matches |
| `rg -n "applyPatch|workspaceEdit|rename|replaceBody|insertBefore|insertAfter|safeDelete|symbol.*apply|ast-grep.*apply|patch planner|patch apply" openclaw_runtime/src/runtime-core/grounding.ts openclaw_runtime/src/runtime-core/index.ts tests/unit/runtime-grounding-contracts.test.ts` | no matches |
| `rg -n "raw trace|trace dump|full trace|raw payload|full payload|full checkpoint|rawChat|raw chat|transcript import|jsonl import|full tool args|full tool output|toolArgs|toolOutput|stdout|stderr|process\\.env|complete env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|includeRaw|rawRetained" openclaw_runtime/src/runtime-core/grounding.ts openclaw_runtime/src/runtime-core/index.ts tests/unit/runtime-grounding-contracts.test.ts` | matches only expected `includeRaw` / `rawRetained` contract fields and tests |
| `rg -n "GroundingRef|GroundingQuery|grounding" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src --glob "!**/*.md"` | no GroundingRef/GroundingQuery runtime wiring; only existing lowercase grounding/backgrounding text in agent prompts/exec messages |

Local note: `rtk` was not available in this PowerShell session, so validation used the equivalent `node` and `rg` commands.

Status: accepted
