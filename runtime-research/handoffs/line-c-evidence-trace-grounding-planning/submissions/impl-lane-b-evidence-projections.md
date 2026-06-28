# Line C Grounding Spine Impl Lane B Evidence Projections

## Scope

- Added derived-only grounding projection helpers in `openclaw_runtime/src/runtime-core/grounding.ts` for EvidenceRef, projected file/test strings, RuntimeTaskEvent, RuntimeTaskEventLogRecord, Checkpoint, checkpoint diagnostics, EvidenceVerifierReport, and EvidenceVerifierFinding.
- Kept all projections local and readonly. No TaskLoop, Gateway, producer contract, persistence, database, exporter, listener, service, gate, or provider-ordering changes were added.
- Preserved fixed `authority: "none"`, top-level `rawRetained: false`, `projection.derived: true`, and `projection.rawRetained: false` through `makeGroundingRef` / sanitizer paths.

## Projection Notes

- `groundingRefFromEvidenceRef` and `groundingRefsFromEvidenceRefs` default EvidenceRef identity projections to `trust: "supplied"` and `projection.lossy: false`.
- Duplicate EvidenceRef inputs dedupe deterministically by canonical key while preserving first-seen ordering.
- `groundingRefForProjectedFile` and `groundingRefForProjectedTest` mark string-derived refs `trust: "projected"` and `projection.lossy: true`.
- Runtime events and event-log records retain only ids, kind/status/count metadata, bounded summaries, trace ids, and linked EvidenceRefs. They do not retain full payload objects.
- Checkpoint projections retain checkpoint id, state, counts, bounded summary, and linked EvidenceRefs. They do not retain full checkpoint JSON, tool results, file hash values, or raw payloads.
- Evidence verifier report/finding refs may be `verified` for the report/finding record itself. Linked evidence refs default to `supplied` and are explicitly marked `linkedRefsAutoVerified: false`.
- Renderer, external, and explicitly untrusted projection sources force `trust: "untrusted"`.

## Tests

- Extended `tests/unit/runtime-grounding-ref-projections.test.ts` with coverage for:
  - EvidenceRef stable canonical keys and supplied trust.
  - deterministic duplicate EvidenceRef dedupe.
  - projected file/test string refs as lossy projected refs.
  - RuntimeTaskEvent evidence plus traceContext projection.
  - event-log projection excluding payload retention.
  - checkpoint projection excluding full checkpoint/tool payload retention.
  - checkpoint diagnostics projection.
  - EvidenceVerifierReport and EvidenceVerifierFinding projection.
  - verified verifier finding not upgrading linked evidence refs.
  - fixed `authority: "none"` across projected refs.

## Validation

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-ref-projections.test.ts` | pass, 1 file / 15 tests |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-checkpoint-serializer.test.ts` | pass, 6 files / 54 tests |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| `rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\\(|daemon|listener|service|database|sqlite|postgres|mysql|redis|sidecar" openclaw_runtime/src/runtime-core/grounding.ts tests/unit/runtime-grounding-ref-projections.test.ts` | no matches |
| `rg -n "writeFile|appendFile|createWriteStream|mkdir|\\.jsonl|\\.sqlite|sqlite|kysely|better-sqlite3|database|persist|cache|store|sidecar" openclaw_runtime/src/runtime-core/grounding.ts tests/unit/runtime-grounding-ref-projections.test.ts` | no matches |
| `rg -n "applyPatch|workspaceEdit|rename|replaceBody|insertBefore|insertAfter|safeDelete|symbol.*apply|ast-grep.*apply|patch planner|patch apply" openclaw_runtime/src/runtime-core/grounding.ts tests/unit/runtime-grounding-ref-projections.test.ts` | no matches |

Local note: `rtk` was not available in this PowerShell session, so validation used the equivalent `node` and `rg` commands.

Status: accepted
