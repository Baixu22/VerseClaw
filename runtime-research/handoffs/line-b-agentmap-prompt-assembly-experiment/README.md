# Line B AgentMap Prompt Assembly Experiment

This handoff starts the AgentMap prompt assembly experiment after the accepted runtime-use readiness synthesis. The experiment is not a prompt cutover plan. It only evaluates how explicit readonly AgentMap diagnostic output can be converted into a bounded prompt candidate/addendum.

## Required Task Spec

Use:

```text
harness/specs/tasks/phase-line-b-agentmap-prompt-assembly-experiment.md
```

Before implementation and before acceptance review, run:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-assembly-experiment.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-assembly-experiment.md
```

## Allowed

- A pure, deterministic helper that takes explicit `AgentMapResult` input and returns candidate text plus metadata.
- An explicit default-off config flag for the experiment.
- Focused tests proving opt-in behavior, bounded output, deterministic ordering, stable snapshots, prompt-present file exclusion, diagnostic metadata, and token budget behavior.
- Documentation and structured diagnostics proving no prompt authority, no tool authority, no runtime authority, and legacy prompts remain authoritative.

## Forbidden

- Default-on AgentMap behavior.
- Default prompt assembly cutover.
- TaskLoop, Gateway, provider transport, model-message, or chat prompt cutover.
- Provider ordering changes or default AgentMap provider registration.
- Replacing, wrapping, discouraging, or disabling `read`, `grep`, `find`, or `ls`.
- Mutation/apply/edit operations such as AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, or workspace edit.
- New services, listeners, daemons, HTTP/WebSocket servers, external databases, graph databases, second Gateways, or second runtime services.

## Exit Criteria

The experiment may be accepted only if validation proves:

- explicit opt-in/default-off behavior;
- bounded deterministic candidate text from explicit readonly AgentMap input;
- prompt-present files excluded from candidate text;
- structured metadata includes `experimental`, `readonlyAgentMap`, `defaultOff`, `noPromptCutover`, `noPromptAuthority`, `noToolAuthority`, and `noRuntimeAuthority`;
- default runtime behavior, default prompt text/order, TaskLoop, Gateway, model messages, provider transport, provider ordering, and direct discovery tools remain unchanged;
- focused tests, existing AgentMap tests, config schema tests, typecheck, and boundary scans pass or are documented as unrelated existing false positives.
