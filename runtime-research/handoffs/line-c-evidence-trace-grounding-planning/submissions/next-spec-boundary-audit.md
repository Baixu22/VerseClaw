# Line C Next Spec Boundary Audit

Status: accepted

## Scope

This is an advisory boundary audit for the next Line C Grounding Spine task
spec. It is not the final task spec and it does not authorize implementation.

This audit accepts only a future readonly, shadow, derived-only grounding spine
planning target. It rejects runtime authority, renderer transport changes,
services, exporters, listeners, persistence, databases, raw retention, and
memory durable fact promotion from unverified material.

## Inputs Reviewed

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `openclaw_runtime/AGENTS.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/synthesis.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/deep-validation.md`
- `runtime-research/handoffs/phase-5-evidence-verifier/synthesis.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/synthesis.md`

## Rejected-Boundary Checklist

A next spec should be marked `needs_revision` if it does not explicitly reject
all of these boundaries:

- No runtime implementation may start before the fresh harness task spec is
  accepted.
- No completion gate, verifier enforcement, active pilot gate, or terminal
  status cutover.
- No TaskLoop, Gateway, provider-ordering, retry, approval, security, or
  runtime policy authority from grounding records.
- No renderer-owned transport logic, direct renderer IPC, direct Gateway HTTP
  calls, direct Gateway WebSocket calls, or protocol switching in renderer code.
- No services, daemons, listeners, servers, exporters, collectors, Temporal
  workers, OpenTelemetry/OTLP export, or observability platform integration.
- No new persistence, database, sidecar, index, cache, JSON/JSONL/TXT state
  file, or package dependency for the grounding spine.
- No raw trace dump, raw payload, full checkpoint, full tool args/output, full
  prompt, environment, credentials, secrets, API keys, auth headers, or
  unbounded transcript retention.
- No durable memory fact promotion from raw chat, raw trace, renderer evidence,
  external trace context, subagent prose, unsourced metadata, or projected
  source anchors.
- No source refs replacing verifier evidence. Source refs are explanatory links
  only.
- No patch apply behavior. Patch refs, if mentioned, remain planning-only and
  require a separate accepted spec.
- No UI or user-visible behavior change. If a later spec adds one, it must add
  Electron E2E coverage and full i18n, but this Line C grounding spec should not
  add UI.
- No doc/README behavior claims unless the implementation actually changes a
  user-visible flow. Spec drafting may cite research handoffs without changing
  product docs.

## GroundingRef / GroundingQuery Non-Authority Rules

The next spec must make non-authority a hard contract, not an implication.

- Every `GroundingRef` must be derived from existing records. It must not become
  the canonical producer of evidence, trace, checkpoint, memory, AgentMap,
  Symbol, event-log, verifier, or TaskLoop records.
- `GroundingRef.authority` must be fixed as `"none"`. It should not be
  optional, inferred, or widened to an enum that can later contain active
  authority.
- `GroundingRef.trust` is descriptive only. Even `trust: "verified"` means the
  derived record points at a verified deterministic finding; it does not make
  linked file, source, trace, tool, checkpoint, or memory refs authoritative.
- `GroundingQuery` must be `readonly: true`, summary-only, local, bounded, and
  side-effect free.
- `GroundingQuery.includeRaw` must be rejected, ignored, or fixed to `false`.
  It must not unlock raw trace, raw payload, full checkpoint, full tool
  args/output, prompt, env, auth, or secret material.
- Query ranking may order results for explanation, but it must not satisfy
  verifier evidence, completion checks, blocked/failed decisions, retry
  decisions, permission checks, security policy, provider selection, context
  provider ordering, or patch application.
- Renderer evidence, external trace context, subagent text, raw logs, raw tool
  I/O, and unsourced metadata must be `untrusted` or rejected. They must not
  become authority through a grounding projection.
- Source refs, file refs, symbol refs, and checkpoint refs may help explain
  relevance. They must not replace Evidence Verifier inputs or human/operator
  approval where those are required.

## Memory Durable Fact Promotion Prohibitions

The grounding spine may feed future memory consumers as refs or summaries only.
The next spec should prohibit all durable memory writes and all fact promotion
unless a separate accepted memory spec owns that behavior.

Prohibited promotion sources:

- raw chat logs, raw assistant messages, raw user messages, or transcript dumps;
- raw traces, `ContextItem(kind: "trace")` summaries by themselves, trace dumps,
  external `traceparent`, `tracestate`, or `baggage` values;
- raw tool args, raw tool output, stdout/stderr, command text, env, credentials,
  auth headers, API keys, or secret-like strings;
- renderer-projected refs, external trace refs, subagent prose, issue/PR text,
  docs snippets, or unsourced metadata without verifier/human/deterministic
  promotion evidence;
- AgentMap/Symbol/source anchors by themselves;
- `GroundingRef` records whose only support is `supplied`, `projected`, or
  `untrusted` material;
- failed, blocked, cancelled, insufficient, or incomplete verifier evidence;
- full checkpoints or checkpoint JSON as memory evidence.

Allowed future promotion shape, only in a later memory-owned spec:

- verifier-backed, human-approved, or deterministic-rule promotion evidence;
- explicit source episode/evidence refs;
- temporal bounds such as `valid_at` / `invalid_at`;
- idempotency, invalidation, retention, and rollback rules;
- sanitized summaries rather than raw payloads.

## Renderer / Main / host-api / api-client Boundary Scan

Even if the next spec does not touch renderer files, it should require a scan
that proves the boundary stayed clean.

Minimum scan requirement:

```text
rtk rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|fetch\(['\"]https?://(127\.0\.0\.1|localhost):18789|new WebSocket\(['\"]ws://(127\.0\.0\.1|localhost):18789|gateway:httpProxy|hostapi:fetch" src/pages src/components src/hooks src/lib electron shared --glob "!**/*.md"
```

Required classification:

- No new direct renderer `ipcRenderer.invoke` calls in pages, components, hooks,
  or feature code.
- No renderer direct HTTP/WebSocket calls to the Gateway.
- If any host route is needed in a later accepted spec, renderer calls must enter
  through `src/lib/host-api.ts` and `src/lib/api-client.ts`; Main owns transport
  policy.
- Transport remains Main-owned as `WS -> HTTP -> IPC fallback`; renderer must
  not implement switching, failover, or business logic for protocol selection.
- Existing matches, if any, must be classified by file and ownership. A noisy
  scan without classification is not sufficient.

## Service / Exporter / Listener / Database Scan

The next spec must forbid new runtime infrastructure and require a touched-file
scan plus a focused broad scan. Existing pre-Line-C surfaces may be classified,
but no new grounding-spine service or persistence is allowed.

Minimum touched-file scan pattern:

```text
rtk rg -n "createServer\(|\.listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|collector|exporter|@opentelemetry/exporter|opentelemetry.*export|@temporalio|express\(|daemon|listener|service|database|sqlite|better-sqlite3|kysely|\.db\b|JSONL|sidecar" <touched source and test files>
```

Required classification:

- No service, daemon, listener, server, second Gateway/runtime, Temporal worker,
  exporter, collector, OTLP/OpenTelemetry upload, observability platform, new
  database, sidecar, JSON/JSONL/TXT runtime state, or persistence path.
- No new package dependency for grounding storage, telemetry, exporting, or
  service hosting.
- Broad scans may hit existing Gateway/OAuth/proxy/test-helper/plugin/config or
  memory SQLite surfaces. These must be named as pre-existing and unrelated, not
  ignored.
- Existing memory persistence is not a license for Line C grounding persistence.
  The grounding spine remains derived, readonly, and non-durable.

## Raw Trace / Payload / Checkpoint / Tool I/O Retention Scan

The next spec must require a retention scan over all touched source files and
tests, with match-by-match classification. It should fail acceptance if any new
raw retention is added.

Minimum scan pattern:

```text
rtk rg -n "raw trace|trace dump|full trace|raw payload|full payload|full checkpoint|checkpoint json|raw checkpoint|full tool args|raw tool args|full tool output|raw tool output|stdout|stderr|complete env|process\.env|secret|secrets|api[-_ ]?key|authorization|password|bearer|token|sk-[A-Za-z0-9_-]{8,}|includeRaw|rawRetained|rawPayload|fullPayload" <touched source and test files>
```

Accepted match classes:

- sanitizer denylist patterns;
- redaction fixtures that prove sensitive material is removed;
- bounded key names/counts without values;
- existing compact summaries with no new raw material;
- diagnostics that do not return or persist full payloads.

Rejected match classes:

- any returned, stored, logged, queried, exported, or memory-promoted raw trace;
- full checkpoint serialization in grounding output;
- full tool args/output, stdout/stderr, env, prompt, transcript, auth, secret, or
  credential retention;
- `includeRaw: true`, `rawRetained: true`, or equivalent escape hatches;
- tests that assert raw material is available through grounding outputs.

## Files That May Be Touched

For this audit task, only this file may be touched:

- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/next-spec-boundary-audit.md`

For the next spec drafting task, the allowed touch set should be limited to:

- a new harness task spec, preferably
  `harness/specs/tasks/line-c-evidence-trace-grounding-spine.md`;
- existing harness rule/scenario docs only if the spec needs to promote a
  reusable validation rule, and only with explicit rationale;
- research handoff notes under
  `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/` only if
  they are cross-references or closeout notes, not implementation plans.

For a later implementation task after the spec is accepted, the spec may propose
a narrow candidate allowlist such as:

- a new derived grounding contract/helper file under
  `openclaw_runtime/src/runtime-core/`;
- focused unit tests under `tests/unit/runtime-grounding-*.test.ts`;
- minimal exports only if existing module structure requires them.

That future allowlist should be treated as advisory until the task spec is
accepted.

## Files That Must Be Forbidden

For this audit and for next-spec drafting, all code and product behavior files
must be forbidden:

- `openclaw_runtime/src/**`
- `src/**`
- `electron/**`
- `shared/**`
- `tests/**`
- `package.json`
- lockfiles and shrinkwrap files
- README/product docs, unless the accepted work later changes user-visible
  behavior

For the first future implementation slice, the spec should also forbid these
unless a separate accepted spec explicitly expands scope:

- `openclaw_runtime/src/agents/task-loop-controller.ts`
- `openclaw_runtime/src/gateway/**`
- `openclaw_runtime/src/context-engine/provider-registry.ts`
- `openclaw_runtime/src/runtime-core/memory-*.ts`
- `openclaw_runtime/src/runtime-core/*persistence*.ts`
- `src/lib/host-api.ts`
- `src/lib/api-client.ts`
- renderer pages/components/hooks
- Electron Main/preload transport files
- database migrations, state-store files, telemetry/exporter files, service
  startup files, and package dependency files

The point of the first implementation slice should be derived helpers and tests,
not wiring or ownership changes.

## Risk List For The Next Spec

- Authority creep: `GroundingRef` or `GroundingQuery` starts as explanation but
  becomes completion, retry, verifier, security, provider, or TaskLoop policy.
- Trust inflation: `verified` trust gets misread as authority over linked source
  refs rather than only over the deterministic finding.
- Source-ref substitution: file/source/symbol/checkpoint anchors are used in
  place of Evidence Verifier evidence or human approval.
- Raw retention creep: debugging convenience adds raw trace, payload,
  checkpoint, tool args/output, env, prompt, or transcript access.
- Memory shortcut: grounding summaries become durable memory facts without a
  memory-owned promotion spec.
- Renderer bypass: a query UI or helper reaches directly into IPC/Gateway
  transport instead of host-api/api-client.
- Infrastructure drift: the spine is framed as telemetry and grows an exporter,
  collector, listener, service, database, or sidecar.
- Persistence drift: a "small cache" becomes runtime state outside SQLite owner
  rules or without a migration/doctor owner.
- Test masking: tests include raw fixtures but do not assert absence from
  outputs, logs, summaries, query results, and memory inputs.
- Broad-scan noise: existing Gateway/memory/service matches are waved away
  without classifying touched-file deltas.
- Public API drift: helper exports become wider than current callers need.
- Patch-planning bleed: patch refs imply apply behavior without a separate AST
  Patch Planner spec.

## Spec Acceptance Wording Suggestions

Suggested acceptance wording for the next task spec:

```text
Acceptance requires a readonly, shadow-only, derived-only Grounding Spine.
GroundingRef and GroundingQuery have fixed authority: "none" and cannot affect
completion, failed/blocked/cancelled status, verifier enforcement, retry,
approval, security policy, provider ordering, TaskLoop/Gateway behavior,
renderer transport, context provider ordering, memory fact promotion, or patch
application.
```

```text
Acceptance requires no new service, listener, daemon, exporter, collector,
OpenTelemetry/OTLP integration, Temporal worker, Gateway/runtime process,
database, sidecar, JSON/JSONL/TXT runtime state, cache, persistence path, or
package dependency.
```

```text
Acceptance requires GroundingQuery to be readonly, local, bounded,
summary-only, and side-effect free. includeRaw must remain false or be rejected.
No grounding output may retain or return raw trace dumps, raw payloads, full
checkpoints, full tool args/output, full prompts, transcripts, env, auth
headers, credentials, secrets, or API keys.
```

```text
Acceptance requires memory to be a consumer only. The grounding spine must not
write durable memory, promote facts, or treat trace/source summaries as durable
truth. Durable fact promotion requires a separate memory-owned accepted spec
with verifier-backed, human-approved, or deterministic-rule promotion evidence,
temporal bounds, invalidation, retention, idempotency, and rollback.
```

```text
Acceptance requires focused tests for derivation, canonical keys, dedupe, trust
classification, renderer/external untrusted handling, source refs as
non-authoritative links, bounded query output, includeRaw rejection, fixed
authority: "none", and absence of raw retention.
```

```text
Acceptance requires the renderer/Main/host-api/api-client boundary scan, the
service/exporter/listener/database scan, and the raw-retention scan to be run
over touched files and relevant focused surfaces. Every match must be classified
as accepted pre-existing/sanitizer/test-redaction material or rejected before
the task can be marked accepted.
```

## Status Criteria

- `accepted`: This audit is ready to feed the next spec. Use this status only
  when the next spec includes the hard rejection boundaries, scan requirements,
  allowed/forbidden touch sets, and non-authority wording above.
- `needs_revision`: Use this for a next spec that is generally on the right
  path but omits explicit non-authority, raw-retention, memory-promotion,
  renderer boundary, infrastructure, database, or touch-set restrictions.
- `blocked`: Use this only if the requested next spec requires implementation
  before spec acceptance, requires authority/persistence/raw-retention by
  design, or cannot be evaluated because required handoff/source context is
  missing.

Status: accepted
