# AgentMap Prompt Candidate Cutover Readiness Window Prompts

Use these prompts for isolated lane windows. Every window must preserve the spec-only boundary.

## Shared Window Preamble

```text
You are working on Line B AgentMap prompt candidate cutover readiness.

This is spec-only/readiness-only. Do not implement prompt cutover. Do not add AgentMap candidate text to default prompt assembly, TaskLoop prompts, reviewer prompts, Gateway requests, model messages, provider transport, chat prompts, user prompts, or system prompts. Do not change runtime behavior, config schema, default flags, provider ordering, persistence, TaskLoop behavior, renderer IPC, or Gateway calls.

Read:
- AGENTS.md
- openclaw_runtime/AGENTS.md
- runtime-research/agent-runtime-index.md
- harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
- runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/README.md
- runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/parallel-lanes.md
- runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-pilot/synthesis.md
- runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof/synthesis.md

Write your result using submission-template.md. Your lane acceptance is not cutover approval.
```

## Lane A Prompt

```text
Work on Lane A: Prompt byte parity and diff-risk map.

Map every current prompt/model boundary that must remain byte-identical while AgentMap flags are off: TaskLoop reviewer prompt, default prompt assembly, system prompt, user prompt, chat prompt, model messages, Gateway request, and provider transport.

Define the future before/after snapshot proof required before any candidate text can be inserted. Prove this phase changes no prompt text/order and keeps candidate text absent from all prompt/model/Gateway/provider paths.
```

## Lane B Prompt

```text
Work on Lane B: Authority and rollback gate.

Define the no-authority invariants from current AgentMap runtime shadow reports and context provider metadata. Require no runtime, tool, security, approval, retry, completion-gate, provider-ordering, Gateway, or model-message authority from AgentMap. Define rollback by disabling AgentMap prompt flags, omitting explicit AgentMap input, and omitting optional AgentMap provider registration.
```

## Lane C Prompt

```text
Work on Lane C: Budget and prompt-present promotion criteria.

Define future thresholds for token budget stability, complete symbol blocks, prompt-present exclusion, and diagnostics. Require proof that prompt-present files never duplicate existing prompt context. Treat current Phase 8/9 budget and prompt-present tests as evidence, not cutover permission.
```

## Lane D Prompt

```text
Work on Lane D: Provider/Gateway/model-message boundary proof.

Define scans and tests required to prove no unintended Gateway, provider transport, model-message, renderer, or provider-ordering cutover. Define when comms replay/compare are mandatory. Prove default provider registry order remains legacy-context-engine then loop-context-pack unless a future implementation spec explicitly changes it with accepted rollback proof.
```

## Lane E Prompt

```text
Work on Lane E: Validation, docs, and synthesis readiness.

Confirm lanes A-D exist and contain scope, accepted inputs, forbidden outputs, required proof, rollback condition, and validation commands/scans. Run or require harness context/validate, focused tests or docs-only skip, typecheck decision, boundary scans, README docs-sync scan, and comms replay/compare decision. Define whether synthesis can become accepted or must remain needs_revision.
```
