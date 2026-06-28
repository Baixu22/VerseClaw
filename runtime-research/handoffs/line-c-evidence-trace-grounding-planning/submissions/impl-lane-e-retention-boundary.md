# Line C Grounding Spine Impl Lane E Retention / Boundary

## Gate

- Lane A contracts were checked first via `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/impl-lane-a-contracts.md`.
- Lane A status: accepted.
- Required task context was run with `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md`.
- `rtk` was not available in this PowerShell session, so commands were run directly with equivalent `node` / `rg` invocations.

## Scope

- Added `tests/unit/runtime-grounding-retention-boundary.test.ts`.
- Tests prove the retention/boundary spine around existing `GroundingRef`, `GroundingQuery`, and `GroundingResult` contracts:
  - raw prompt/chat/trace/full-trace smuggling fields are stripped from sanitized refs;
  - full payload/checkpoint/tool args/tool output/stdout/stderr/env/secrets are absent from refs and results;
  - `includeRaw: true` normalizes to `includeRaw: false` and does not surface raw sentinel data;
  - `rawRetained` remains false at top-level, projection metadata, and sanitization metadata;
  - `authority` remains `"none"` for refs and result items;
  - source refs remain source anchors and do not satisfy Evidence Verifier required evidence;
  - renderer/external/subagent/model summaries are represented only as `untrusted` / `projected` with lossy projections and no authority;
  - result items are bounded by `limit` and `tokenBudget`;
  - grounding exports do not expose persistence/write/service/listener/exporter/apply/mutation helpers.
- `openclaw_runtime/src/runtime-core/grounding.ts` received compile-only alignment for current Line C helper code: trace/event-log imports and query bounds used by existing helper functions were restored, undefined `toolName` is omitted from JSON metadata, and the `includeRaw` diagnostic reads the raw record shape because typed `GroundingQuery` only permits `false`.
- No TaskLoop, Gateway, provider ordering, renderer transport, persistence/database/service/exporter/listener, or patch-apply behavior was added.

## Validation

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts` | pass, 2 files / 17 tests |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |

## Scans

- Renderer direct IPC/Gateway broad scan:
  - `rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components electron shared --glob '!**/*.md'`
  - Result: existing Main/preload/Gateway-owner references and policy/i18n text only.
  - Focused renderer pages/components scan with the same pattern over `src/pages src/components`: no matches.
- Service/exporter/listener/database scan over grounding implementation/tests:
  - Matches only `tests/unit/runtime-grounding-retention-boundary.test.ts` assertion text that proves no such exports.
  - Production-only `openclaw_runtime/src/runtime-core/grounding.ts` scan: no matches.
- Raw-retention scan over grounding implementation/tests:
  - Matches expected `includeRaw` / `rawRetained` contract fields and the new retention-boundary assertions.
  - No raw sentinel payload is retained by the tests.
- Persistence/sidecar scan over grounding implementation/tests:
  - Matches the new boundary-test forbidden-export regex and one production false positive in text `stored only as untrusted sanitized keys`.
  - No persistence, database, sidecar, file-write, or cache helper is introduced.
- Patch apply/mutation scan over grounding implementation/tests:
  - Matches only the new boundary-test forbidden-export regex.
  - Production-only `openclaw_runtime/src/runtime-core/grounding.ts` scan: no matches.
- Authority scan over grounding implementation/tests:
  - Matches expected contract/test references that force `authority: "none"`.
- Runtime wiring scan:
  - `rg -n 'GroundingRef|GroundingQuery|grounding' openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src --glob '!**/*.md'`
  - Result: no `GroundingRef` / `GroundingQuery` runtime wiring; only existing lowercase "grounding/backgrounding" prose in agent prompt/exec text.

## Docs

- README updates are not required: this is a runtime-core/test boundary proof with no user-visible behavior, flow, interface, UI, or docs change.
- Comms replay/compare were not run because this lane did not touch Main/Gateway/host-api/api-client/provider transport paths.

Status: accepted
