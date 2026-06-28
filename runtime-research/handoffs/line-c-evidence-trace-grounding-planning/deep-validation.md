# Line C Deep Validation And Next-Step Judgment

Status: accepted

## Verdict

Line C is ready for the next step, but the next step should be a fresh harness
task spec before implementation. The four planning waves are internally
consistent, the expanded tests pass, and the boundary scans do not show a Line C
runtime/service/raw-retention violation.

Do not jump directly into runtime code. The first follow-up should specify a
readonly/shadow Grounding Spine MVP with derived-only `GroundingRef` and
`GroundingQuery` helpers.

## Inputs Checked

- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/README.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/parallel-lanes.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/window-prompts.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/lane-a-inventory.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/lane-b-evidence-ref-normalization.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/lane-c-trace-source-query.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/synthesis.md`

All lane submissions and synthesis end in `Status: accepted`.

## Validation Run

Harness validation:

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-5-evidence-verifier.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md` | pass |

Harness context:

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/phase-5-evidence-verifier.md` | pass |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass |

Expanded unit coverage:

```text
node node_modules/vitest/vitest.mjs run
  tests/unit/runtime-evidence-verifier-contracts.test.ts
  tests/unit/runtime-evidence-verifier-collectors.test.ts
  tests/unit/runtime-trace-context-contracts.test.ts
  tests/unit/runtime-trace-context-store.test.ts
  tests/unit/runtime-trace-context-provider.test.ts
  tests/unit/runtime-event-log-store.test.ts
  tests/unit/runtime-checkpoint-serializer.test.ts
  tests/unit/runtime-verification-auto-sampling.test.ts
  tests/unit/task-loop-controller.test.ts
  tests/unit/runtime-memory-context-contracts.test.ts
  tests/unit/runtime-memory-store.test.ts
  tests/unit/runtime-memory-proposal-shadow.test.ts
  tests/unit/runtime-memory-context-provider.test.ts
  tests/unit/runtime-memory-persistence.test.ts
  tests/unit/runtime-memory-runtime-integration.test.ts
  tests/unit/runtime-feature-config-schema.test.ts
  tests/unit/runtime-agent-map-contracts.test.ts
  tests/unit/runtime-agent-map-ranking.test.ts
  tests/unit/runtime-agent-map-renderer.test.ts
  tests/unit/runtime-agent-map-budget.test.ts
  tests/unit/runtime-agent-map-context-provider.test.ts
  tests/unit/runtime-symbol-tool-contracts.test.ts
  tests/unit/runtime-symbol-tool-readonly.test.ts
  tests/unit/runtime-symbol-context-provider.test.ts
  tests/unit/context-provider-registry.test.ts
```

Result: pass, 25 files / 174 tests.

Typecheck:

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |

## Boundary Scans

Renderer pages/components boundary:

```text
rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components --glob '!**/*.md'
```

Result: no matches.

Focused Line C service/exporter/listener scan:

```text
rg -n "createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|daemon|listener" \
  openclaw_runtime/src/runtime-core/evidence.ts \
  openclaw_runtime/src/runtime-core/evidence-verifier.ts \
  openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts \
  openclaw_runtime/src/runtime-core/trace-context.ts \
  openclaw_runtime/src/runtime-core/trace-context-store.ts \
  openclaw_runtime/src/context-engine/trace-context-provider.ts \
  openclaw_runtime/src/agents/task-loop-controller.ts \
  tests/unit/runtime-evidence-verifier-contracts.test.ts \
  tests/unit/runtime-evidence-verifier-collectors.test.ts \
  tests/unit/runtime-trace-context-contracts.test.ts \
  tests/unit/runtime-trace-context-store.test.ts \
  tests/unit/runtime-trace-context-provider.test.ts
```

Result: no matches.

Broad consumer/database scan note:

- A broader scan over all `runtime-core` and `context-engine` surfaces matches
  existing `memory-persistence.ts` SQLite usage.
- Classification: existing Phase 9+ memory persistence surface, not a Line C
  grounding-spine service or new database. The next Line C spec should still
  explicitly forbid new persistence, sidecars, exporters, listeners, and
  databases.

Raw-retention scan:

```text
rg -n "raw trace|trace dump|full trace|raw payload|full payload|full checkpoint|full tool args|full tool output|complete env|secrets?|api[-_ ]?key|authorization|password|sk-[A-Za-z0-9_-]{8,}" \
  openclaw_runtime/src/runtime-core/evidence.ts \
  openclaw_runtime/src/runtime-core/evidence-verifier.ts \
  openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts \
  openclaw_runtime/src/runtime-core/trace-context.ts \
  openclaw_runtime/src/runtime-core/trace-context-store.ts \
  openclaw_runtime/src/context-engine/trace-context-provider.ts \
  openclaw_runtime/src/agents/task-loop-controller.ts \
  openclaw_runtime/src/runtime-core/memory-context.ts \
  openclaw_runtime/src/runtime-core/agent-map.ts \
  openclaw_runtime/src/runtime-core/symbols.ts
```

Classification:

- `trace-context.ts` matches sanitizer denylist regexes and external
  `tracestate` / `baggage` key handling.
- `memory-context.ts` matches raw-retention rejection patterns and sensitive
  input rejection codes.
- `task-loop-controller.ts` matches existing sensitive-task detection and source
  file path strings.
- No raw trace dump, full payload, full checkpoint, full tool args/output, env,
  secret retention, exporter, or service was found for Line C.

Grounding implementation pre-check:

```text
rg -n "GroundingRef|GroundingQuery" openclaw_runtime/src src electron shared --glob '!**/*.md'
```

Result: no matches. Line C is still planning-only; no runtime implementation has
already slipped in.

## Judgment

Accepted:

- The planning set has enough evidence to create the next harness task spec.
- The proposed spine should bridge Evidence Verifier, Trace Context, event-log,
  checkpoint, Memory, AgentMap/Symbol, and future AST Patch Planner as derived
  refs and bounded queries.
- `GroundingRef` and `GroundingQuery` should be implemented only as readonly
  helpers over existing producers in the first code slice.

Not accepted yet:

- Runtime behavior changes.
- Evidence Verifier blocking completion gate.
- TaskLoop/Gateway/runtime call-site cutover.
- Provider ordering default cutover.
- Persistence/database/sidecar for grounding.
- OpenTelemetry exporter/collector/listener/service.
- Raw trace/full payload/full checkpoint/full tool args-output retention.
- Memory durable facts from unverified claims.
- Patch apply behavior.

## Recommended Next Step

Create a fresh task spec:

```text
harness/specs/tasks/line-c-evidence-trace-grounding-spine.md
```

Recommended scope for that spec:

1. Add derived-only runtime-core grounding contracts/helpers:
   - `GroundingRef`
   - `GroundingRefTrust`
   - `GroundingQuery`
   - bounded `GroundingResult` / summary shape
2. Add projection helpers from existing surfaces:
   - `EvidenceRef`
   - `TaskLoopEvidenceRef` and TaskLoop file/test projections
   - `RuntimeTraceSpan` / `RuntimeTraceSourceRef`
   - `RuntimeTaskEvent` / event-log records
   - `Checkpoint` / checkpoint serializer diagnostics
   - verifier reports/findings
   - memory source/evidence refs as consumer material
   - AgentMap/Symbol source anchors as consumer material
3. Add tests only for derivation/query behavior:
   - dedupe and canonical keys
   - trust classification
   - renderer/external untrusted handling
   - source refs as evidence links only
   - token/query bounds
   - raw-retention rejection
   - fixed `authority: "none"`
4. Do not wire the spine into TaskLoop/Gateway/provider ordering by default.
5. Repeat the harness validates, expanded focused tests, typecheck, renderer
   boundary scan, service/exporter/listener scan, raw-retention scan, and
   `GroundingRef|GroundingQuery` implementation-scope scan before synthesis.

## Suggested Implementation Lanes After Spec Acceptance

Do these only after the fresh task spec is accepted:

1. Lane A: contracts and fixtures for derived grounding types.
2. Lane B: projection helpers from evidence/verifier/checkpoint/event-log.
3. Lane C: projection/query helpers from trace/source plus bounded summaries.
4. Lane D: consumer projection adapters for memory/AgentMap/Symbol with no
   provider-ordering change.
5. Lane E: validation/docs/synthesis.

Final recommendation: proceed to spec drafting now, not runtime code.
