# Constraint Brief

This is the durable constraint text for future runtime failure/evidence/replay/scorecard/governance work.

## Core Direction

The runtime should become better at explaining and evaluating task outcomes without accidentally granting new authority to diagnostics. The work is split into five lanes:

1. Failure Intelligence: classify where and why a task failed, whether recovery is possible, and what action is recommended.
2. Evidence Envelope: provide a uniform read-only evidence container for prompt assembly, diagnostics, replay, test results, file-change summaries, benchmark results, and failure summaries.
3. Replay Harness: make important runtime task paths reproducible, comparable, and scoreable.
4. Outcome Scorecard: compare task quality across runtime changes using replay/evidence-backed metrics.
5. Tool Governance: reduce unsafe tool use, repeated failures, long-running processes, environment contamination, and unclear ask-user decisions.

## Hard Constraints

- Evidence is not authority.
- Evidence must not write checkpoint authority state.
- Evidence must not write lifecycle authority state.
- Evidence must not enter provider transport, model messages, prompt assembly, TaskLoop decisions, retries, approvals, rollback, tool blocking, or completion gates unless a future accepted spec explicitly defines that consumer.
- Evidence must carry source, scope, TTL, confidence, provenance, and redaction state.
- Evidence injection must fail closed when required metadata is missing, expired, out of scope, unredacted, malformed, or below threshold.
- Replay and scorecard artifacts are evaluation evidence, not task-completion proof by themselves.
- Tool governance must start narrow and evidence-backed; broad active blocking requires replay/scorecard proof and a fresh implementation spec.
- No second runtime service, daemon, listener, local server, database, exporter, or always-on sidecar may be added for these lanes without a separate accepted architecture spec.
- No raw persistent capture of prompts, model messages, provider payloads, secrets, tool args/results, environment dumps, or broad workspace content.

## Development Guardrail

Do not build the five lanes as one large feature. Build vertical slices:

1. Schema spike.
2. Passive Failure Intelligence.
3. Evidence Envelope fail-closed validation.
4. Replay core and narrow fixture set.
5. Scorecard from replay reports.
6. Tool governance rules proven by replay deltas.

Every implementation slice must include:

- owned paths
- feature flags
- fail-closed behavior
- tests
- replay fixture impact
- boundary scans
- rollback
- acceptance criteria

## Decision Bias

Prefer reversible, passive, local, deterministic, and test-owned artifacts first. Defer default-on behavior, active enforcement, provider/Gateway changes, and persistent runtime stores until replay evidence proves benefit and a fresh spec accepts the risk.
