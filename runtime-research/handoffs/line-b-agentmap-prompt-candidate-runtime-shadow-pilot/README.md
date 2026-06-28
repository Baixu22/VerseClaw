# Line B AgentMap Prompt Candidate Runtime Shadow Pilot

This handoff starts the runtime shadow pilot after the accepted AgentMap prompt assembly experiment. The pilot is diagnostics/evidence only. It observes candidate metadata and runtime boundaries without changing prompts, model messages, provider transport, Gateway payloads, provider ordering, or TaskLoop decisions.

## Required Task Spec

Use:

```text
harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-pilot.md
```

Before implementation and before acceptance review, run:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-pilot.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-pilot.md
```

## Allowed

- A default-off config flag such as `runtime.agentMap.promptCandidateRuntimeShadow?: boolean`.
- A pure adapter that accepts explicit `AgentMapResult` input plus explicit runtime/TaskLoop metadata and returns a shadow diagnostic report.
- TaskLoop/runtime diagnostic collection only when both `runtime.agentMap.promptAssemblyExperiment === true` and `runtime.agentMap.promptCandidateRuntimeShadow === true`.
- Runtime shadow diagnostics for candidate status, budget, token estimate, included symbol/file counts, prompt-present exclusion counts, and non-authority flags.
- Tests proving default-off parity, explicit opt-in, no prompt/message mutation, no provider ordering change, and no runtime authority.

## Forbidden

- Default-on AgentMap behavior.
- AgentMap default provider registration.
- Prompt cutover into TaskLoop prompts, reviewer prompts, Gateway requests, provider transport, model messages, chat prompts, or system prompts.
- Default prompt assembly text/order changes.
- Runtime authority, tool authority, approval authority, retry authority, security-policy authority, or completion-gate authority from AgentMap output.
- Replacing, wrapping, discouraging, or disabling `read`, `grep`, `find`, or `ls`.
- Mutation/apply/edit operations such as AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, or workspace edit.
- New services, listeners, daemons, HTTP/WebSocket servers, external databases, graph databases, second Gateways, or second runtime services.

## Exit Criteria

The pilot may be accepted only if validation proves:

- explicit opt-in/default-off behavior;
- double opt-in for TaskLoop/runtime diagnostics;
- no prompt, model-message, Gateway, provider transport, provider ordering, or runtime decision mutation;
- shadow diagnostics carry non-authority flags and candidate measurement metadata only;
- focused tests, existing AgentMap/config/TaskLoop tests, typecheck, and boundary scans pass or are documented as unrelated existing false positives.
