---
id: runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract
title: Runtime Failure Tool Invocation Governance Destructive Operation Guard Boundary Scan Import Contract
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Create a design/proof contract for the future `destructive_operation_guard` active-consumer import boundary, proving that only a later accepted mutation-capable tool invocation preflight owner may consume active guard code, without implementing an active guard.
ownedPaths:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract.md
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
touchedAreas:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract.md
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract/**
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
expectedUserBehavior:
  - Runtime behavior is unchanged.
  - No active `destructive_operation_guard` implementation or consumer is added.
  - TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, checkpoint, lifecycle, Electron services, renderer code, and tool-blocking behavior remain unchanged.
  - Replay, scorecard, advisory, governance, and evidence proof artifacts remain evidence producers only, not active decision owners.
  - `block` remains future candidate metadata only; it is not a current runtime decision, not default behavior, and not completion proof.
  - The only future allowed active consumer boundary is a later accepted mutation-capable tool invocation preflight owner.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
  - workspace-harness-single-source
featureFlags:
  - This phase does not add or read a runtime feature flag.
  - A future implementation phase must still keep `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` explicit and default-off.
  - Closing, omitting, or setting that future flag to any non-boolean-true value must restore legacy tool behavior with no migration or state cleanup.
rollback:
  - Delete this boundary-scan-import-contract task spec and handoff package.
  - Remove the boundary/import contract entries from the parent schema decision log and synthesis.
  - No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing rollback is required because this phase writes docs/spec material only.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract.md
  - Bounded manual import scan over the denied roots documented in the validation plan.
acceptance:
  - The new spec has complete harness metadata, intent, owned paths, touched areas, expected user behavior, required rules, feature flag notes, rollback, required tests, acceptance, forbidden patterns, and docs references.
  - The handoff package records boundary/import contract scope, validation plan, and synthesis.
  - The phase explicitly states that it is design/proof-contract only and not active runtime readiness.
  - The allowed active consumer is limited to a later accepted mutation-capable tool invocation preflight owner.
  - Denied roots are explicit and include TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, replay, scorecard, advisory generation, evidence proof, retry, approval, rollback, completion, checkpoint, lifecycle, Electron main/services, renderer surfaces, and broad active runtime roots.
  - Replay, scorecard, governance, advisory, and evidence proof code remain evidence producers, not active decision owners.
  - The import contract forbids active owner imports from docs/proof helpers into denied roots and forbids denied roots from importing a future active guard module.
  - The bounded scan contract uses explicit path lists and exact candidate symbol/module names; it does not scan unbounded workspace content or persist raw runtime payloads.
  - A future implementation spec must add focused automated boundary scan coverage before any active guard code is introduced.
  - This phase does not implement an active guard, add active imports, wire active runtime paths, read live providers, execute tools, mutate the real workspace, persist raw payloads, or change runtime behavior.
forbiddenPatterns:
  - implementing an active guard, active runtime consumer, TaskLoop consumer, provider consumer, Gateway consumer, prompt/model-message consumer, retry consumer, approval consumer, rollback consumer, completion consumer, checkpoint consumer, lifecycle consumer, renderer consumer, Electron service consumer, or tool-blocking consumer
  - changing TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry behavior, approval behavior, rollback behavior, completion behavior, checkpoint behavior, lifecycle behavior, renderer behavior, Electron service behavior, or tool-blocking behavior
  - adding imports or wiring from denied roots to advisory, scorecard, replay, evidence proof, proposal, boundary scan, or future active guard helpers
  - treating `block` as a current runtime decision, default behavior, completion proof, or active tool block
  - using deleted touched-path metadata alone, broad shell command patterns, slow command metadata alone, or known dev-server-like long-running metadata as an active trigger
  - writing replay reports, scorecards, governance reports, governance diagnostics, failure events, evidence envelopes, proposal docs, boundary scan docs, evidence proof reports, or future guard decisions into checkpoint or lifecycle authority state
  - reading live providers, executing real tool mutation, modifying the real workspace, scanning unbounded workspace content, or using live provider/tool data as proof
  - persisting raw prompts, provider payloads, tool args/results, secrets, environment dumps, unredacted workspace content, or raw provider/tool evidence
  - adding a service, daemon, listener, HTTP server, WebSocket server, database, exporter, scheduler, always-on sidecar, second Gateway, second runtime, or external transport
  - treating governance reports, replay reports, scorecards, evidence, failure events, evidence proof output, boundary scan output, or this handoff package as task completion proof
docs:
  required: true
  files:
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract/README.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract/validation-plan.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract/synthesis.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
---

# Runtime Failure Tool Invocation Governance Destructive Operation Guard Boundary Scan Import Contract

This Phase C package is a design/proof contract for the `destructive_operation_guard` active-consumer boundary. It proves the route has an explicit allow/deny import contract before any active implementation phase.

It does not implement an active guard, add a runtime consumer, connect to TaskLoop, change provider transport or Gateway payloads, change prompt/model-message assembly, alter retry/approval/rollback/completion behavior, block tools, read live providers, execute real tools, mutate the real workspace, or write governance/proof metadata into checkpoint or lifecycle authority state.

## Allowed Future Consumer

The only allowed future active consumer is a later accepted mutation-capable tool invocation preflight owner.

That owner does not exist in this phase. Phase D, if later accepted, must name its concrete module path and prove it is the mutation-capable preflight layer before it may import active guard code.

## Denied Roots

The import contract denies active guard consumption from:

- TaskLoop and agents orchestration
- provider transport and provider ordering
- Gateway payloads and Gateway server methods
- prompt/model-message assembly
- replay harness code
- task outcome scorecard code
- governance advisory generation
- evidence proof helpers
- retry, approval, rollback, and completion paths
- checkpoint and lifecycle authority state
- Electron main, Electron services, IPC handlers, and preload surfaces
- renderer pages, components, stores, and lib surfaces
- scripts, exporters, daemons, services, listeners, databases, schedulers, or always-on sidecars

Docs and tests may reference the contract. Evidence producers may continue producing diagnostics-only metadata, but they may not own active decisions.

## Import Contract

A future active guard module must not be imported by denied roots. Denied roots also must not import advisory, scorecard, replay, evidence proof, proposal, or boundary contract helpers to make active decisions.

Allowed future consumption requires all of these:

- a later accepted implementation spec
- explicit default-off flag `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`
- concrete mutation-capable tool invocation preflight owner path
- no denied-root imports
- false-block corpus still passing
- trigger gate still requiring deleted touched-path metadata, failing `wrong_file_edit` or `unnecessary_edit`, Phase 5 `futureActiveCandidate.action = "block"`, and `requiresAcceptedSpec = true`

## Bounded Scan Contract

Boundary scans must use explicit path lists and exact candidate names. They must not scan unbounded workspace content or persist raw runtime payloads.

Candidate names for Phase C and later scans:

- `destructive-operation-guard`
- `destructive_operation_guard`
- `DestructiveOperationGuard`
- `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`
- `futureActiveCandidate`
- `failure-tool-invocation-governance-destructive-operation-guard`

Current Phase C scan results are contract evidence only. They do not approve runtime readiness because no active guard exists yet.

## Stop Line

This phase stops after the import contract is documented and validated. It does not begin Phase D.
