# Phase 6 Parallel Implementation Lanes

All lanes may run in separate windows. Each lane must preserve legacy behavior by default and must write its own submission under `submissions/`.

## Shared Acceptance Rules

An accepted lane must include:

- exact files reviewed and changed;
- path/function evidence for each implemented or design claim;
- focused tests or a scoped not-applicable explanation;
- flag-off parity evidence for touched legacy behavior;
- sanitization/redaction evidence and raw-retention scans;
- external `traceparent` / `tracestate` / baggage handling evidence;
- token-budget evidence for summaries, or a lane-scoped not-applicable explanation;
- source-ref/evidence-ref separation evidence;
- forbidden-pattern boundary scans;
- comms replay/compare when Main/Gateway communication paths changed.

Use `needs_revision` for missing evidence, broad claims without path/function/test support, raw retention, trusted external trace context, unbudgeted prompt/UI trace dumps, default-on behavior, or trace-derived runtime authority.

## Lane A: Contracts And Harness

LANE_ID: `lane-a-contracts-and-harness`

LANE_TITLE: Runtime trace contract, taxonomy, handoff scaffold, and harness spec

LANE_SCOPE:

- Add the Phase 6 handoff scaffold and task spec.
- Define the canonical runtime-core trace/span contract without live runtime wiring.
- Cover trace id/span id/parent id/link/status/timestamp/source-ref/evidence-ref shapes.
- Define trace flags, type guards, sanitizer/redaction helpers, fixture builder, and deterministic query/summary contract tests.
- Keep all flags default-off and contract/shadow-only.
- Do not touch TaskLoop, Gateway, renderer, or provider-registry integration in this lane.
- Evidence must prove default-off flags, contract-only behavior, sanitizer coverage, external trace context rejection/untrusted marking, source-ref/evidence-ref separation, and no service/exporter/UI/provider wiring.

SUGGESTED_PATHS:

- `runtime-research/handoffs/phase-6-trace-context-provider/**`
- `harness/specs/tasks/phase-6-trace-context-provider.md`
- `openclaw_runtime/src/runtime-core/trace-context.ts`
- `openclaw_runtime/src/runtime-core/index.ts`
- `tests/unit/runtime-trace-context-contracts.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-6-trace-context-provider/submissions/lane-a-contracts-and-harness.md
```

## Lane B: Local Span Store Query

LANE_ID: `lane-b-local-span-store-query`

LANE_TITLE: In-memory trace store, query filters, and budgeted summary

LANE_SCOPE:

- Add a bounded local in-memory trace/span store over the Lane A contract.
- Support parent/child, link, task/tool/file/symbol/status/time range queries.
- Prioritize error/test/verifier/evidence-linked spans in `summarizeTrace(traceId, tokenBudget)`.
- Store only sanitized refs, counts, codes, bounded labels, and summaries.
- Do not persist raw trace dumps, prompts, full event payloads, full checkpoint payloads, full tool args/output, env, secrets, or unbounded command output.
- Do not introduce a database, service, listener, exporter, or UI.
- Evidence must prove retention bounds, clone/read isolation, query dimensions, linked-span semantics, token-budgeted summaries, sanitizer use on append, and touched-file raw-retention/service/exporter scans.

## Lane C: Propagation Recording Shadow

LANE_ID: `lane-c-propagation-recording-shadow`

LANE_TITLE: Default-off Main/Gateway/runtime trace propagation and recording shadow

LANE_SCOPE:

- Wire trace context only behind explicit default-off runtime trace flags.
- Keep renderer transport through host-api/api-client/Main-owned proxy paths.
- Preserve TaskLoop, `tools.invoke`, approval waiting, retry, error mapping, return payloads, event-log/checkpoint behavior, and Evidence Verifier behavior with flags off.
- Sanitize or re-root external `traceparent`; never trust renderer/user-provided trace headers as local authority.
- If Main/Gateway paths change, run comms replay/compare.
- Evidence must prove flag-off parity for TaskLoop, `tools.invoke`, approval, retry, error mapping, return payloads, event-log/checkpoint/resume, and Evidence Verifier for every touched path.
- Evidence must show external trace context is rejected, re-rooted, sanitized, or marked untrusted and that raw header values, `tracestate`, and baggage values are not retained.

## Lane D: Context Provider Summary

LANE_ID: `lane-d-context-provider-summary`

LANE_TITLE: Readonly RuntimeTraceContextProvider and budgeted context items

LANE_SCOPE:

- Add a readonly `RuntimeTraceContextProvider` adapter over accepted trace queries.
- Return budgeted context items, not full trace dumps.
- Rank error spans, current task/tool/file/symbol matches, verifier/test spans, linked resume/evidence spans, then siblings.
- Keep provider registration default-off/shadow-only and do not change provider ordering by default.
- Do not make trace context a completion gate, security policy, retry policy, or runtime authority.
- Evidence must prove provider output is token-budgeted, redacted, readonly, source/evidence linked, disabled when `runtime.traceContext.provider` is false, and absent from default provider ordering.

## Lane E: Validation Docs Synthesis Readiness

LANE_ID: `lane-e-validation-docs-synthesis-readiness`

LANE_TITLE: Phase 6 validation, boundary scans, docs/index updates, synthesis readiness

LANE_SCOPE:

- Validate `phase-6-trace-context-provider` harness spec and relevant existing specs.
- Confirm A-D submissions exist and each has exactly one valid `Status`.
- Run focused trace context tests, node typecheck, renderer/Main boundary scans, second-service/exporter scans, and comms replay/compare if Main/Gateway paths changed.
- Review README docs only if A-D changed user-visible behavior or documented RPC behavior.
- Update `runtime-research/agent-runtime-index.md` only after synthesis accepts Phase 6.
- Evidence must classify broad scan matches as pre-existing or Phase-6-added, rerun touched-file scans, verify required files are referenced, and record whether Phase 7 entry criteria are met.

## Phase 7 Readiness Check

Lane E and synthesis must not mark Phase 6 ready for Runtime Memory Provider unless A-D evidence proves local sanitized queryable spans, budgeted trace context items, non-authoritative source refs, untrusted external trace context handling, and no trace-to-memory fact promotion. Any Phase 7 work requires a fresh spec forbidding raw chat-log memory and requiring verifier-backed temporal facts.
