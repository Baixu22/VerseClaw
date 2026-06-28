# AgentMap Prompt Candidate Cutover Readiness Parallel Lanes

All lanes are planning/evidence lanes. Do not implement prompt cutover, alter runtime behavior, change config schema/defaults, register AgentMap by default, change provider ordering, add persistence, or insert AgentMap candidate text into any prompt/model/Gateway/provider path.

## Shared Acceptance Rules

An accepted lane must include:

- exact files reviewed and changed;
- proof that Phase 8 runtime shadow pilot synthesis is accepted;
- proof that Phase 9 replay proof synthesis is accepted;
- proof that the runtime index records both accepted Phase 8/9 AgentMap markers;
- no runtime behavior change proof for this phase;
- explicit flag-off and rollback requirements;
- no candidate text in TaskLoop prompts, reviewer prompts, Gateway requests, model messages, provider transport, user prompts, chat prompts, or system prompts;
- no candidate/replay persistence proof;
- no automatic AgentMap discovery from TaskLoop;
- no mutation/apply/edit surface proof;
- no service/listener/daemon/database proof;
- renderer IPC/Gateway boundary proof;
- docs-sync and comms replay/compare decision.

Use `needs_revision` for missing evidence, ambiguous cutover permission, accidental prompt/model/provider/Gateway insertion, default-on behavior, config schema changes, provider ordering changes, candidate persistence, runtime authority, mutation surface, service/listener/database additions, or unverified rollback claims.

## Lane A: Prompt Byte Parity And Diff-Risk Map

LANE_ID: `lane-a-prompt-byte-parity-diff-risk-map`

LANE_TITLE: Prompt byte parity and diff-risk map

LANE_SCOPE:

- Map the exact current prompt assembly surfaces that must remain byte-identical while AgentMap flags are off.
- Define future before/after prompt snapshot proof required before any candidate text can be inserted.
- Include TaskLoop reviewer prompt, default prompt assembly, system prompt, user prompt, chat prompt, model messages, Gateway request, and provider transport.
- Prove this readiness phase does not change prompt assembly text/order or prompt/model/Gateway/provider payloads.

ACCEPTED_INPUTS:

- Phase 8/9 accepted shadow diagnostics and replay proof.
- Existing pure candidate assembly helper and runtime shadow adapter as measurement-only sources.
- Existing tests that assert reviewer prompt parity and candidate text absence.

FORBIDDEN_OUTPUTS:

- Any candidate text insertion into prompt/model/Gateway/provider paths.
- Any default prompt assembly text/order change.
- Treating content hash, token estimate, or diagnostics metadata as prompt authority.

REQUIRED_PROOF:

- Read `openclaw_runtime/src/runtime-core/agent-map-prompt-assembly-experiment.ts`.
- Read `openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-runtime-shadow.ts`.
- Read `openclaw_runtime/src/agents/task-loop-context.ts`.
- Read `openclaw_runtime/src/agents/loop-context-pack.ts`.
- Read `tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts`.
- Future cutover proposals must include byte snapshots for all mapped prompt/model/Gateway/provider surfaces with flags off and on, plus explicit diffs that isolate only the proposed cutover text.

ROLLBACK_CONDITION:

- Disabling `runtime.agentMap.promptAssemblyExperiment` or `runtime.agentMap.promptCandidateRuntimeShadow`, or omitting explicit AgentMap input, must restore byte-identical legacy prompt behavior immediately.

VALIDATION_COMMANDS_SCANS:

```text
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/task-loop-controller.test.ts
rg -n "model messages|provider transport|Gateway request|system prompt|user prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt|prompt cutover|candidate cutover" <agentmap-cutover-readiness-touched-files>
```

## Lane B: Authority And Rollback Gate

LANE_ID: `lane-b-authority-rollback-gate`

LANE_TITLE: Authority and rollback gate

LANE_SCOPE:

- Define explicit non-authority invariants from current shadow reports.
- Define rollback requirements for disabling AgentMap flags and omitting explicit AgentMap inputs/providers.
- Require no runtime, tool, security, approval, retry, completion-gate, provider-ordering, Gateway, or model-message authority from AgentMap.
- Prove this readiness phase does not change TaskLoop runtime behavior.

ACCEPTED_INPUTS:

- Runtime shadow report authority fields.
- AgentMap context provider shadow-only metadata.
- TaskLoop explicit AgentMapResult injection requirement.

FORBIDDEN_OUTPUTS:

- AgentMap-derived runtime decisions, task-loop decisions, approval decisions, retry decisions, completion gates, security policy, tool permission policy, provider-ordering policy, Gateway policy, or model-message policy.
- Automatic AgentMap discovery from TaskLoop.

REQUIRED_PROOF:

- Read `openclaw_runtime/src/agents/task-loop-controller.ts`.
- Read `openclaw_runtime/src/context-engine/agent-map-context-provider.ts`.
- Read `tests/unit/runtime-agent-map-context-provider.test.ts`.
- Read `tests/unit/task-loop-controller.test.ts`.
- Future cutover proposals must show disabled parity, rollback by flag removal, and no-authority metadata for every AgentMap-derived output.

ROLLBACK_CONDITION:

- Disable AgentMap prompt flags, disable/omit `runtime.agentMap.provider`, omit explicit AgentMapResult injection, and keep legacy TaskLoop/context/provider behavior authoritative.

VALIDATION_COMMANDS_SCANS:

```text
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/context-provider-registry.test.ts tests/unit/task-loop-controller.test.ts
rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|runtime\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
```

## Lane C: Budget And Prompt-Present Promotion Criteria

LANE_ID: `lane-c-budget-prompt-present-promotion-criteria`

LANE_TITLE: Budget and prompt-present promotion criteria

LANE_SCOPE:

- Define future acceptance thresholds for token budget stability, complete symbol blocks, prompt-present exclusion, and diagnostics.
- Require evidence that prompt-present files never duplicate existing prompt context.
- Require future promotion criteria before candidate text can be considered for prompt insertion.
- Prove this readiness phase does not change budget behavior or candidate assembly.

ACCEPTED_INPUTS:

- Existing prompt assembly experiment complete-symbol-block behavior.
- Existing runtime shadow budget and prompt-present replay proof.
- Existing `tests/fixtures/agent-map/**` ClawX-like fixtures.

FORBIDDEN_OUTPUTS:

- Partial symbol block insertion.
- Prompt-present duplication.
- Candidate text persistence.
- Budget diagnostics becoming prompt authority.

REQUIRED_PROOF:

- Read `tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts`.
- Read `tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts`.
- Read `tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts`.
- Read `tests/fixtures/agent-map/**`.
- Future cutover proposals must define maximum token drift, complete-symbol-block invariants, prompt-present exclusion proof, and before/after diagnostics thresholds.

ROLLBACK_CONDITION:

- When candidate budget proof fails or prompt-present duplication appears, keep AgentMap in diagnostics-only mode and do not insert candidate text.

VALIDATION_COMMANDS_SCANS:

```text
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts
rg -n "writeFile|appendFile|mkdir|rm\(|unlink|createWriteStream|fs\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <agentmap-cutover-readiness-touched-files>
```

## Lane D: Provider/Gateway/Model-Message Boundary Proof

LANE_ID: `lane-d-provider-gateway-model-message-boundary-proof`

LANE_TITLE: Provider/Gateway/model-message boundary proof

LANE_SCOPE:

- Define scans/tests required to prove no unintended Gateway, provider transport, model-message, renderer, or provider-ordering cutover.
- Define comms replay/compare trigger conditions.
- Prove `createContextProviderRegistryPilot()` default ordering remains legacy context engine then loop context pack.
- Prove this readiness phase touches no Main/Gateway/host-api/api-client/provider transport/runtime send-receive/channel/fallback paths.

ACCEPTED_INPUTS:

- Existing provider registry tests.
- Existing AgentMap provider explicit injection tests.
- Existing renderer/Main API boundary rules.

FORBIDDEN_OUTPUTS:

- Gateway request mutation.
- Provider transport mutation.
- Model message mutation.
- Direct renderer IPC or direct Gateway HTTP/WebSocket calls.
- Default provider registration or provider ordering changes.

REQUIRED_PROOF:

- Read `openclaw_runtime/src/context-engine/provider-registry.ts`.
- Read `tests/unit/context-provider-registry.test.ts`.
- Future cutover proposals must include provider/Gateway/model-message boundary scans and comms replay/compare whenever communication paths change.

ROLLBACK_CONDITION:

- Omit AgentMap extra provider registration and keep the default registry order unchanged; if communication paths drift, rollback the cutover proposal before acceptance.

VALIDATION_COMMANDS_SCANS:

```text
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/context-provider-registry.test.ts
rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
pnpm --config.verify-deps-before-run=false run comms:replay
pnpm --config.verify-deps-before-run=false run comms:compare
```

Run comms replay/compare only if Main/Gateway/host-api/api-client/provider transport/runtime send-receive/channel/fallback paths are touched.

## Lane E: Validation, Docs, And Synthesis Readiness

LANE_ID: `lane-e-validation-docs-synthesis-readiness`

LANE_TITLE: Validation, docs, and synthesis readiness

LANE_SCOPE:

- Define exact harness/tests/typecheck/scans/docs-sync required for this readiness phase and any future cutover proposal.
- Define how synthesis can become accepted or must remain needs_revision.
- Confirm A-D lane material exists and contains scope, accepted inputs, forbidden outputs, required proof, rollback condition, and validation commands/scans.

ACCEPTED_INPUTS:

- Task spec and handoff docs.
- Validation results from harness context/validate, focused tests or documented docs-only skip, typecheck decision, boundary scans, README docs-sync scan, and comms decision.

FORBIDDEN_OUTPUTS:

- Accepting synthesis before validation passes.
- Updating `runtime-research/agent-runtime-index.md` before synthesis acceptance.
- Hiding boundary scan matches without classification.

REQUIRED_PROOF:

- Run required harness context and validate.
- Run focused tests unless documented as unnecessary because only Markdown/docs changed.
- Skip typecheck only if no TS/JS/JSON code changed and document the reason.
- Run all required boundary scans and classify docs-only/spec-only hits.
- Run README docs-sync scan.
- Run or explicitly skip comms replay/compare with reason.

ROLLBACK_CONDITION:

- If validation fails or a forbidden behavior appears, keep synthesis as `Status: needs_revision`, do not update the runtime index, and document the blocking evidence.

VALIDATION_COMMANDS_SCANS:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```
