# Line B AgentMap Prompt Candidate Runtime Shadow Replay Proof

This handoff starts the runtime shadow replay proof after the accepted AgentMap prompt candidate runtime shadow pilot. The slice is diagnostics/evidence only. It proves replay stability, budget behavior, prompt-present exclusion, disabled gates, TaskLoop prompt parity, and authority boundaries without changing prompts, model messages, provider transport, Gateway payloads, provider ordering, or TaskLoop decisions.

## Required Task Spec

Use:

```text
harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof.md
```

Before implementation and before acceptance review, run:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof.md
```

## Prerequisite

Before implementation, confirm:

- `runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-pilot/synthesis.md` has `Status: accepted`.
- `runtime-research/agent-runtime-index.md` records `accepted_line_b_phase_8_agentmap_prompt_candidate_runtime_shadow_pilot_default_off_diagnostics_only`.

## Allowed

- Focused replay/stability tests around the existing pure runtime shadow adapter.
- Fixture helpers that run the same explicit `AgentMapResult` and runtime/TaskLoop metadata through the adapter repeatedly.
- Budget variants for zero, too-small, medium, and full caller token budgets.
- Prompt-present exclusion variants using `tests/fixtures/agent-map/clawx-like-workspace`.
- TaskLoop tests proving no report without both flags and explicit valid AgentMapResult.
- TaskLoop tests proving reviewer context text is unchanged and candidate text is absent.

## Forbidden

- Default-on AgentMap behavior.
- AgentMap default provider registration or provider ordering changes.
- Prompt cutover into TaskLoop prompts, reviewer prompts, Gateway requests, provider transport, model messages, chat prompts, user prompts, or system prompts.
- Default prompt assembly text/order changes.
- Automatic AgentMap discovery from TaskLoop.
- Runtime authority, tool authority, approval authority, retry authority, security-policy authority, or completion-gate authority from AgentMap output.
- Replacing, wrapping, discouraging, or disabling `read`, `grep`, `find`, or `ls`.
- Mutation/apply/edit operations such as AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, or workspace edit.
- New services, listeners, daemons, HTTP/WebSocket servers, external databases, graph databases, second Gateways, or second runtime services.
- Disk persistence for AgentMap candidate or replay reports.

## Exit Criteria

The replay proof may be accepted only if validation proves:

- previous runtime shadow pilot remains accepted;
- explicit double opt-in/default-off behavior;
- stable pure adapter metadata across repeated equivalent input;
- budget and prompt-present variants affect diagnostics/report metadata only;
- TaskLoop emits no report without both flags and explicit valid AgentMapResult;
- TaskLoop reviewer context/prompt text is unchanged and candidate text is absent;
- default provider ordering remains legacy context engine then loop context pack;
- candidate text never enters prompts, Gateway, model messages, provider transport, or disk persistence;
- focused tests, existing AgentMap/config/TaskLoop tests, typecheck, and boundary scans pass or are documented as unrelated existing false positives.
