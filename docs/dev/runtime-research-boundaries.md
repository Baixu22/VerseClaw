# Runtime research: stable architecture and safety boundaries

This is the maintained contract extracted from the archived runtime research and handoff packages. It replaces those packages as a current engineering input; it is not a new runtime implementation, a rollout approval, a performance result, or evidence that a historical gate passed on a new candidate.

## Authority and defaults

- Preserve the current implementation, accepted feature-specific specs, and [product default matrix](default-config-matrix.md). Archiving a proposal never enables its proposed feature or reverses an already accepted, narrowly scoped exception.
- Research stages, readiness scores, suggested next steps, and `accepted_*` handoff markers describe their original scope and candidate only. They do not grant `defaultOn`, `liveReady`, `productApproved`, production rollout, or joint-system GA.
- No new service, listener, daemon, database, transport, runtime, or Gateway is authorized by this document. Existing runtime-owned stores, policy evaluators, and execution owners remain authoritative.
- Renderer pages/components use host-api/api-client. Main owns Gateway transport and fallback. Research helpers cannot add renderer direct IPC, direct Gateway HTTP/WebSocket, or independent provider ordering.
- Validation and review may be agent-driven, with `driven_by: agent` and an identified actor. Never fabricate real-human evidence. Product locks and default changes still require their separate authorization; automated evidence does not grant it.

## AST structured planning

The corrected pipeline is:

```text
AgentMap/Symbol scope -> AST candidate plan -> Evidence Verifier -> explicit apply gate
```

AST is a structured code-edit planning layer, not runtime intelligence or a general runtime optimization layer. The TypeScript text matcher is a prototype/fallback safety skeleton; the real ast-grep adapter returns EditPlan IR and bounded diagnostics.

- Readonly candidate generation consumes caller-owned, explicit, bounded targets. A planning result does not authorize repository-wide scanning, broad workspace edits, symbol mutation, automatic TaskLoop invocation, prompt/model-message insertion, or Gateway/provider integration.
- `runtime.astPatchPlanner.readonlyScan` and `runtime.astPatchPlanner.previewDiff` remain independently opt-in/default false. An explicit helper call is not permission to change either default.
- Invalid rules, overbroad patterns, unbound metavariables, overlap, source/range/preview fingerprint drift, missing targets, or exceeded budgets must fail closed or require review as specified by the existing helper contract.
- Preserve EditPlan IR, the real ast-grep adapter, verifier-readiness bridge, apply-gate checks, and their behavior tests. Apply eligibility is descriptive; verifier readiness is not an execution grant.
- The existing controlled explicit apply helper is a separate surface. It requires independent scoped approval, a passing apply gate, current fingerprints, target hashes and excerpts, non-overlapping supported operations, and `allowWrite` for a non-dry-run. Tests use explicit test-owned temporary targets. This exception does not authorize general workspace mutation.
- AST output, preview diffs, `dry_run_ready`, `applied`, and replay/decision reports are not task-completion evidence.
- The historical P7 decision was `run_later_narrow_evaluation`, not a usable broad runtime pilot. Any later evaluation needs its own accepted spec, fixed allowlists, bounded source volume, false-positive and review-time measurements, and a cost envelope. This document does not claim those later measurements exist.

Maintained regression anchors:

- `tests/unit/runtime-ast-patch-planner-contracts.test.ts`
- `tests/unit/runtime-ast-patch-planner-rule-validation.test.ts`
- `tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts`
- `tests/unit/runtime-ast-patch-planner-resume-drift.test.ts`
- `tests/unit/runtime-ast-edit-plan-foundation.test.ts`
- `tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts`
- `tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts`
- `tests/unit/runtime-ast-edit-plan-apply-gate-readiness.test.ts`
- `tests/unit/runtime-ast-edit-plan-controlled-apply-pilot.test.ts`
- `tests/unit/runtime-ast-edit-plan-narrow-rule-replay-proof.test.ts`

## AgentMap component boundary

AgentMap remains a readonly context-candidate and diagnostic-evidence component. A future implementation plan is not default-on enablement, default cutover, or a production-ready declaration.

- The named `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` surface requires explicit invocation, a valid caller-owned AgentMapResult, and all four opt-in gates: `promptAssemblyExperiment`, `promptCandidateRuntimeShadow`, `promptCandidateControlledCutoverPilot`, and `promptCandidateTaskLoopExplicitInvocationPilot`.
- Each gate remains default off by omission. The separate AgentMap provider gate remains separate; default-shaped approval keys cannot enable the pilot.
- Missing/malformed input, a disabled gate, absent invocation, prompt-present exclusions, or exhausted budget must preserve legacy reviewer prompt bytes.
- Candidate, shadow, and replay output must not be persisted. There is no implicit model-message, default reviewer prompt, Gateway, provider transport, checkpoint, or lifecycle payload consumer.
- Diagnostics are bounded counters, booleans, hashes, lengths, and codes. Raw candidate text, prompts, model messages, provider payloads, tool output, secrets, authorization headers, and raw trace/checkpoint/lifecycle bodies must not leak.
- Provider ordering remains unchanged. AgentMap cannot gain runtime, tool, approval, retry, completion, security, or transport authority.

Keep the behavior coverage in `tests/unit/runtime-agent-map-component-boundary-hardening.test.ts` and `tests/unit/runtime-agent-map-default-on-implementation-spec.test.ts`. Their contract assertions read this maintained document and the corresponding task specs, not per-session handoff packages.

## Provider/Tool Registry

Registry diagnostic consumption and AST planning are independent. Historical acceptance of a Registry diagnostic pilot does not approve AST use or a registry cutover.

- Collector/shadow/pilot gates remain explicit and default off where defined by their current contracts.
- Diagnostics are caller-owned, bounded, sanitized, and in memory or explicit test-owned sinks. Missing or invalid injected diagnostics fail closed.
- No diagnostic result can reorder providers, register a default provider, alter MCP response shape, change approval/retry/error semantics, determine TaskLoop status, or authorize tools, transport, persistence, or prompt insertion.
- Preserve structured success/error/denied/waiting/cancelled outcomes, unsupported-content handling, provider exception isolation, and legacy-authoritative behavior.

Regression anchors are `tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts`, `tests/unit/runtime-provider-tool-registry.test.ts`, and the existing context-provider, tool-provider, MCP, and TaskLoop tests.

## Event log, evidence, trace, and grounding

- Canonical event, checkpoint, and receipt owners remain unchanged. Resume must preserve idempotency and must not re-execute completed side-effect calls merely to reconstruct evidence. Source drift returns to review/planning, not false completion.
- Shadow comparisons and diagnostic summaries are not authoritative resume decisions or completion verdicts. Explicit limited-authority helpers retain their own gates; archiving their history does not widen or remove those gates.
- Evidence remains bound to commands/results, source hashes, tool calls, spans, and the candidate that produced it. A final assistant message, diagnostic count, preview, or historical green result is not proof of current task completion.
- Trace context is sanitized and budgeted; external trace identity is validated/re-rooted according to the existing implementation. Source/evidence references are data, not instructions or automatic filesystem reads.
- Preserve the accepted Line C exception: default-on runtime-core diagnostics-summary metadata and its single explicit diagnostics-only consumer. Do not turn this into a blanket default-off change or expand it into TaskLoop/Gateway/prompt/provider authority, raw retention, persistence, or memory promotion.

## Runtime Memory and knowledge

- Candidates, verified facts, activation, and consumption are separate states. No unverified model extraction becomes durable truth or automatic knowledge writeback.
- Preserve existing opt-in, diagnostics-only, local sanitized persistence/hydration, provenance, temporal validity, budget, and rollback boundaries. A research roadmap is not permission for default-on memory or prompt injection.
- Reuse the existing Runtime Memory, SEKB, Knowledge, ContextBlock, receipt, and event-log authorities; do not create a parallel content store or attribution ledger from a paper design.
- Keep source references, hashes, verification and activation status distinct. Retrieval/adoption counters and model self-reports do not establish causal benefit; unknown evidence stays unknown.
- L4 proposals affecting prompts, tool routing, permissions, approvals, or retry policy cannot apply themselves. Any model-facing knowledge consumption remains separately governed by current product specs.

## Using historical specs after archival

The phase task specs retain historical scope (`ownedPaths`/`touchedAreas`), original phase decisions, and provenance. Those historical entries are not a promise that private session artifacts are present in a checkout. Current `docs.files` and executable research scans use this document or a maintained feature spec; behavior regression gates remain executable without the research archive.

The Harness CLI selects profile steps; it does not validate every documentation path or execute every `requiredTests` entry. The engineering acceptance runner does turn `requiredTests` into required gates. Both declarations and actual test discovery must be checked when retiring a historical test.

The four retired Markdown-only test sources belong outside the default unit/integration discovery trees. A `.gitignore` entry alone does not retire a local test, and `coverage.exclude` does not affect discovery. Preserve the existing behavior tests listed above and verify fresh-checkout and local discovery agree.

Historical source manifests, reviewed results, and hashes remain bound to their original candidates. Do not rewrite them to imply a new candidate passed. Generate a new candidate's evidence separately when its applicable gates are actually run.
