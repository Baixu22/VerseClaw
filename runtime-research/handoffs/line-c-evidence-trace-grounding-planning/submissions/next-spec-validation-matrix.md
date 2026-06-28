# Line C Grounding Spine Next-Spec Validation Matrix

Status: accepted

Target next task spec:

```text
harness/specs/tasks/line-c-evidence-trace-grounding-spine.md
```

This matrix designs validation only. It does not authorize implementation,
runtime wiring, test creation, provider-ordering changes, persistence, services,
exporters, or prompt cutover.

## Scope Boundary

The next spec should validate a readonly/shadow Grounding Spine MVP with
derived-only `GroundingRef` and `GroundingQuery` helpers. The first accepted
implementation slice may derive bounded links and summaries from existing
Evidence Verifier, Trace Context, event-log, checkpoint, Memory, AgentMap, and
Symbol surfaces.

The next spec must continue to forbid:

- TaskLoop, Gateway, provider-ordering, prompt assembly, model-message, approval,
  retry, completion-gate, or runtime-authority cutover.
- New persistence, sidecars, SQLite schemas, graph databases, caches, stores, or
  raw retention for grounding.
- New service, listener, daemon, HTTP server, WebSocket server, Temporal service,
  OpenTelemetry collector, OTLP exporter, external telemetry upload, or second
  Gateway/runtime service.
- Raw trace dumps, full payloads, full checkpoints, full tool args/output,
  complete env, secrets, raw chat logs, unbounded command output, or raw source
  text as grounding context.

## Harness Commands

Required harness commands for the next spec:

```text
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md
```

Prerequisite spec revalidation required before accepting the next spec:

```text
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-5-evidence-verifier.md
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md
```

If `rtk` is not available in the local runner, the proof may record the same
commands without the `rtk` prefix and must explicitly note that local runner
fallback.

## RequiredTests Block

Recommended `requiredTests` entries for the next task spec:

```yaml
requiredTests:
  - rtk node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-5-evidence-verifier.md
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md
  - rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/runtime-trace-context-contracts.test.ts tests/unit/runtime-trace-context-store.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-checkpoint-serializer.test.ts tests/unit/runtime-verification-auto-sampling.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/runtime-agent-map-contracts.test.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts tests/unit/runtime-agent-map-budget.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-symbol-tool-contracts.test.ts tests/unit/runtime-symbol-tool-readonly.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/context-provider-registry.test.ts
  - rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components --glob '!**/*.md'
  - rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|daemon|listener|external database|sqlite|postgres|mysql|redis' <line-c-grounding-touched-files>
  - rtk rg -n 'GroundingRef|GroundingQuery|grounding' openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src --glob '!**/*.md'
  - rtk rg -n 'raw trace|trace dump|full trace|raw payload|full payload|full checkpoint|full tool args|full tool output|raw chat|transcript|jsonl|complete env|process\.env|secret|api[-_ ]?key|authorization|password|baggage|tracestate|traceparent|sk-[A-Za-z0-9_-]{8,}' <line-c-grounding-touched-files>
  - rtk rg -n 'writeFile|appendFile|createWriteStream|mkdir|\.jsonl|\.sqlite|sqlite|kysely|better-sqlite3|database|persist|cache|store' <line-c-grounding-touched-files>
  - rtk pnpm run comms:replay and rtk pnpm run comms:compare only if Main/Gateway/host-api/api-client/provider transport, gateway events, runtime send/receive, delivery, or fallback paths changed
```

`<line-c-grounding-touched-files>` must be replaced in the implementation
submission with the actual grounding files, projection adapters, and grounding
tests touched by that lane.

## Focused Unit Test List

Existing regression anchors to keep in the focused Vitest run:

- `tests/unit/runtime-evidence-verifier-contracts.test.ts`
- `tests/unit/runtime-evidence-verifier-collectors.test.ts`
- `tests/unit/runtime-trace-context-contracts.test.ts`
- `tests/unit/runtime-trace-context-store.test.ts`
- `tests/unit/runtime-trace-context-provider.test.ts`
- `tests/unit/runtime-event-log-store.test.ts`
- `tests/unit/runtime-checkpoint-serializer.test.ts`
- `tests/unit/runtime-verification-auto-sampling.test.ts`
- `tests/unit/task-loop-controller.test.ts`
- `tests/unit/runtime-memory-context-contracts.test.ts`
- `tests/unit/runtime-memory-store.test.ts`
- `tests/unit/runtime-memory-proposal-shadow.test.ts`
- `tests/unit/runtime-memory-context-provider.test.ts`
- `tests/unit/runtime-memory-persistence.test.ts`
- `tests/unit/runtime-memory-runtime-integration.test.ts`
- `tests/unit/runtime-feature-config-schema.test.ts`
- `tests/unit/runtime-agent-map-contracts.test.ts`
- `tests/unit/runtime-agent-map-ranking.test.ts`
- `tests/unit/runtime-agent-map-renderer.test.ts`
- `tests/unit/runtime-agent-map-budget.test.ts`
- `tests/unit/runtime-agent-map-context-provider.test.ts`
- `tests/unit/runtime-symbol-tool-contracts.test.ts`
- `tests/unit/runtime-symbol-tool-readonly.test.ts`
- `tests/unit/runtime-symbol-context-provider.test.ts`
- `tests/unit/context-provider-registry.test.ts`

New grounding-focused files required by the next spec:

- `tests/unit/runtime-grounding-contracts.test.ts`
- `tests/unit/runtime-grounding-ref-projections.test.ts`
- `tests/unit/runtime-grounding-query.test.ts`
- `tests/unit/runtime-grounding-retention-boundary.test.ts`

Add a separate context-provider test only if the next implementation lane adds
an explicit default-off grounding provider factory:

- `tests/unit/runtime-grounding-context-provider.test.ts`

## New GroundingRef And GroundingQuery Tests

`runtime-grounding-contracts.test.ts` should prove:

- `GroundingRef`, `GroundingRefTrust`, `GroundingQuery`, and bounded
  `GroundingResult` shapes validate deterministic ids, source kind, task id,
  evidence refs, source refs, trust classification, timestamps, and summary
  bounds.
- Grounding refs carry `authority: "none"` or the equivalent non-authoritative
  contract marker. They are links and summaries, not verifier decisions or
  runtime policy.
- Renderer/external/traceparent-derived material is rejected, sanitized,
  re-rooted, or marked untrusted before it can appear in local grounding output.

`runtime-grounding-ref-projections.test.ts` should prove:

- Existing `EvidenceRef`, `TaskLoopEvidenceRef`, verifier findings, event-log
  records, checkpoint diagnostics, `RuntimeTraceSpan`, `RuntimeTraceSourceRef`,
  memory source/evidence refs, AgentMap anchors, and Symbol anchors can project
  to grounding refs without retaining raw payloads.
- Canonical keys dedupe equivalent refs across producers while preserving
  provenance links and trust differences.
- Source refs remain evidence links only and never replace verifier evidence.

`runtime-grounding-query.test.ts` should prove:

- Queries filter by task id, trace id, evidence id, source kind, file path,
  symbol/name path, status, trust class, and time range where those fields
  exist.
- Ranking is deterministic: verifier-backed, error/test/finding-linked, and
  directly mentioned refs rank ahead of unrelated sibling refs.
- Token and item budgets shrink monotonically, avoid partial raw-payload
  truncation, and return a deterministic overflow/omitted-count summary.
- Linked resume/evidence refs are queryable without being treated as causal
  parents.

`runtime-grounding-retention-boundary.test.ts` should prove:

- Full prompts, full event payloads, full checkpoints, full tool args/output,
  complete env, secrets, traceparent/tracestate/baggage values, raw chat logs,
  raw trace dumps, unbounded command output, and raw source text are rejected or
  redacted before entering `GroundingRef` or `GroundingResult`.
- Projection helpers do not call filesystem write APIs, create stores, create
  sidecars, create SQLite schemas, or import exporter/listener/server packages.

`runtime-grounding-context-provider.test.ts`, if needed, should prove:

- Provider construction is explicit test/shadow injection only.
- Default provider ordering and legacy context output remain unchanged.
- Provider failures are isolated and cannot change TaskLoop completion,
  approval, retry, tool policy, verifier authority, or model-message assembly.

## Boundary Scans

Renderer/Main transport boundary:

```text
rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components --glob '!**/*.md'
```

Expected proof: no matches for this Line C work. If renderer files are not
touched, record that the scan was still clean or explicitly not applicable with
the untouched renderer diff proof.

Service/exporter/listener/database boundary:

```text
rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|daemon|listener|external database|sqlite|postgres|mysql|redis|graph database' <line-c-grounding-touched-files>
```

Expected proof: no new Line C grounding service, exporter, listener, database,
sidecar, cache, or persistence. Any pre-existing memory SQLite references must
be classified as Phase 9+ memory persistence, not grounding-spine storage.

Grounding implementation scope:

```text
rtk rg -n 'GroundingRef|GroundingQuery|grounding' openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src --glob '!**/*.md'
```

Expected proof: no TaskLoop, Gateway, Electron, renderer, shared host contract,
provider ordering, prompt assembly, or model-message cutover. Matches are
allowed only if a later accepted spec explicitly expands scope and updates this
matrix.

Mutation boundary:

```text
rtk rg -n 'applyPatch|workspaceEdit|rename|replaceBody|insertBefore|insertAfter|safeDelete|symbol.*apply|ast-grep.*apply|patch planner|patch apply' <line-c-grounding-touched-files>
```

Expected proof: no mutating symbol tool, AST patch apply, workspace edit, or
patch-planner behavior in the Grounding Spine MVP.

## Raw-Retention Scans

Sensitive/raw payload scan:

```text
rtk rg -n 'raw trace|trace dump|full trace|raw payload|full payload|full checkpoint|full tool args|full tool output|raw chat|transcript|jsonl|complete env|process\.env|secret|api[-_ ]?key|authorization|password|baggage|tracestate|traceparent|sk-[A-Za-z0-9_-]{8,}' <line-c-grounding-touched-files>
```

Expected proof: no raw retention. Sanitizer denylist names, rejection codes, and
negative test fixtures may match only when the proof classifies them as
protective checks rather than retained content.

Persistence/sidecar scan:

```text
rtk rg -n 'writeFile|appendFile|createWriteStream|mkdir|\.jsonl|\.sqlite|sqlite|kysely|better-sqlite3|database|persist|cache|store|sidecar' <line-c-grounding-touched-files>
```

Expected proof: no new grounding-owned writes, stores, sidecars, JSONL files,
SQLite schema, cache, or database. Imports/types from existing producers are
allowed only when the implementation remains derived-only and readonly.

Raw source scan:

```text
rtk rg -n 'rawSource|sourceText|fileContents|fullSource|toolArgs|toolOutput|stdout|stderr|message\.content|prompt' <line-c-grounding-touched-files>
```

Expected proof: grounding summaries may carry bounded snippets, paths, ranges,
ids, hashes, status, and evidence/source links. They must not carry full source,
full prompt, full output, or full message content.

## Typecheck Requirements

Required current Line C typecheck proof:

```text
rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
```

If the next spec owner adopts the scoped OpenClaw runtime `tsgo` lane instead,
the spec must replace this with one explicit authoritative typecheck command and
record why the lane changed. Do not make typecheck proof ambiguous by adding
multiple unrelated type lanes.

## Optional Comms Replay/Compare Trigger

Comms replay/compare is not required for a pure runtime-core contract/helper and
unit-test slice with no Main, Gateway, host-api, api-client, provider transport,
gateway event, runtime send/receive, delivery, or fallback edits.

If any of those communication paths are touched, run and record:

```text
rtk pnpm run comms:replay
rtk pnpm run comms:compare
```

The proof must classify whether changes affect WS -> HTTP -> IPC fallback,
Gateway readiness, host events, host-api facade behavior, or provider transport.

## Acceptance Proof Matrix

| Requirement | Required proof | Reject if |
| --- | --- | --- |
| Harness spec validity | `context` and `validate` pass for `line-c-evidence-trace-grounding-spine.md`; prerequisite specs validate. | New spec fails harness validation or omits prerequisite Line C/Line B/Phase 5-7 continuity. |
| Scope remains readonly/shadow | Diff and scan show only grounding contracts/helpers, projection adapters, docs/specs, fixtures, and unit tests. | TaskLoop, Gateway, provider ordering, prompt assembly, model messages, approval, retry, completion gates, or runtime authority change. |
| `GroundingRef` contract | Contract tests prove deterministic ids, source kind, source/evidence refs, trust, timestamps, bounds, and `authority: "none"`. | Refs become verifier decisions, policy authority, or runtime actions. |
| `GroundingQuery` behavior | Query tests prove deterministic filters, ranking, budget shrinkage, overflow summaries, and linked-ref handling. | Query output is unbounded, nondeterministic, or treats links as causal parentage. |
| Existing producers preserved | Focused Evidence, Trace, EventLog, Checkpoint, Memory, AgentMap, Symbol, and registry tests pass. | Existing producer contracts regress or grounding requires changing their default behavior. |
| Projection coverage | Tests prove derivation from verifier, trace/source, event-log, checkpoint, memory refs, AgentMap anchors, and Symbol anchors. | Grounding starts from raw logs/traces/source instead of existing sanitized producer shapes. |
| Trust classification | Tests prove verifier-backed/local sanitized/external untrusted/candidate material are distinguishable. | External trace or renderer material is trusted as local runtime authority. |
| Raw-retention boundary | Raw-retention scans and negative tests prove no raw prompts, payloads, checkpoints, tool args/output, env, secrets, chat logs, trace dumps, or raw source retention. | Full or raw sensitive material is stored, exposed, or only truncated after entering grounding output. |
| Persistence boundary | Persistence/sidecar scans prove no grounding writes, stores, caches, SQLite schemas, JSONL files, or sidecars. | Grounding adds storage, lazy cache, database, sidecar, or migration surface. |
| Service/export boundary | Boundary scans prove no service, listener, daemon, HTTP/WebSocket server, Temporal service, OTel collector, OTLP exporter, or telemetry upload. | Grounding introduces an always-on process or export path. |
| Renderer/Main boundary | Renderer scan is clean or not applicable with untouched renderer diff proof. | Direct renderer IPC/Gateway HTTP/WebSocket calls are added. |
| Mutation boundary | Mutation scan is clean for patch/symbol/workspace edit behavior. | Grounding introduces AST patch apply, symbol edit apply, workspace edit, rename, or safe delete behavior. |
| Type safety | Required typecheck command passes, or one explicit scoped replacement type lane passes with rationale. | Typecheck is skipped, ambiguous, or replaced without rationale. |
| Comms trigger | Replay/compare is run if communication paths changed; otherwise proof says not applicable. | Main/Gateway/host-api/api-client/provider transport paths change without comms replay/compare proof. |

Final status: accepted
