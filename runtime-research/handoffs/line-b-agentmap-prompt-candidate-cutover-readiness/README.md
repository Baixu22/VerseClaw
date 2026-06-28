# Line B AgentMap Prompt Candidate Cutover Readiness

This handoff starts the spec-only readiness phase after the accepted AgentMap prompt candidate runtime shadow pilot and replay proof. The phase defines future evidence gates for a possible prompt candidate cutover, but it does not approve or implement cutover.

## Required Task Spec

Use:

```text
harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
```

Before synthesis acceptance, run:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
```

## Prerequisites

Before this phase can be accepted, confirm:

- `runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-pilot/synthesis.md` has `Status: accepted`.
- `runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof/synthesis.md` has `Status: accepted`.
- `runtime-research/agent-runtime-index.md` records both accepted Phase 8/9 AgentMap prompt candidate markers.

## Accepted Phase Boundary

This phase may add:

- the cutover readiness task spec;
- this handoff folder;
- lane definitions, prompts, and submission templates;
- readiness acceptance, rollback, and validation matrices;
- documentation-only references to Phase 8/9 evidence;
- a runtime index update only after synthesis is accepted.

## Rejected Phase Boundary

This phase must reject:

- prompt cutover or candidate cutover;
- default-on AgentMap behavior;
- default AgentMap provider registration or provider ordering changes;
- AgentMap candidate text entering default prompt assembly, TaskLoop prompts, reviewer prompts, Gateway requests, model messages, provider transport, chat prompts, user prompts, or system prompts;
- AgentMap runtime, tool, approval, retry, security, completion-gate, provider-ordering, Gateway, or model-message authority;
- TaskLoop automatic AgentMap discovery;
- config schema or default flag changes;
- candidate/replay persistence;
- mutation/apply/edit surfaces;
- new services, listeners, daemons, databases, HTTP servers, or WebSocket servers;
- renderer direct IPC or direct Gateway HTTP/WebSocket calls.

## Required Lanes

- Lane A: Prompt byte parity and diff-risk map.
- Lane B: Authority and rollback gate.
- Lane C: Budget and prompt-present promotion criteria.
- Lane D: Provider/Gateway/model-message boundary proof.
- Lane E: Validation, docs, and synthesis readiness.

Each lane must state scope, accepted inputs, forbidden outputs, required proof, rollback condition, and exact files/tests/scans to inspect.

## Final Integration

The synthesis owner writes:

```text
runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/synthesis.md
```

The synthesis starts as `Status: needs_revision`. It may become `Status: accepted` only after the task spec validates, required scans/tests are run or explicitly skipped with a docs-only reason, and the phase remains spec-only/readiness-only.
