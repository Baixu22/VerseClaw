# Destructive Operation Guard Next Goal Roadmap

Status: roadmap_freeze_local_persistent_not_harness_acceptance.

This document is a local persistent roadmap for future Goals after the
`destructive_operation_guard` evidence-proof phase. It is not an accepted
harness task spec, not active runtime readiness, not completion proof, and not
authority to change runtime behavior. Future work must treat this file as the
single route entry point, then create or resume a Goal for exactly one phase.

## Source Context

This roadmap is grounded in:

- `harness/specs/tasks/runtime-failure-tool-invocation-governance-advisory-rules.md`
- `harness/specs/tasks/runtime-failure-tool-invocation-governance-limited-active-guard-design.md`
- `harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.md`
- `runtime-research/handoffs/runtime-failure-tool-invocation-governance-advisory-rules/README.md`
- `runtime-research/handoffs/runtime-failure-tool-invocation-governance-limited-active-guard-design/README.md`
- `runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof/README.md`
- `runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof/synthesis.md`
- `runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md`
- `runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md`

## Mission / Final Objective

The final objective for `destructive_operation_guard` can only be a narrow
active guard after a future, separate, accepted spec approves it.

That future guard, if ever accepted, must be:

- default-off
- limited to `destructive_operation_guard`
- owned only by mutation-capable tool invocation preflight
- backed by replay, scorecard, governance, and false-block evidence
- disabled by a flag that restores legacy behavior without migration or state
  cleanup

The current evidence-proof phase is not active runtime readiness. It only proves
that fixture-owned and synthetic metadata can describe a candidate trigger and a
false-block corpus. `block` remains future candidate metadata only, specifically
`futureActiveCandidate.action: "block"` with `requiresAcceptedSpec: true`.

## Non-Drift Rules

- All later related tasks must first create or resume a Goal.
- Each Goal may execute exactly one phase from this roadmap.
- Do not skip phases.
- Do not expand runtime wiring for test convenience.
- Do not treat replay reports, scorecards, governance reports, evidence proof,
  evidence, failure events, or readiness docs as completion proof.
- Do not add broad shell pattern blocking.
- Do not allow deleted path metadata alone to become an active trigger.
- If a boundary is unclear, stop and write a follow-up instead of continuing
  implementation.

## Phase Plan

### Phase A: Roadmap Freeze

Goal prompt:

Create or update only
`runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof/next-goal-roadmap.md`
as the local persistent roadmap for future `destructive_operation_guard` Goals.

Allowed work:

- Read the required specs, handoffs, schema decision log, and synthesis docs.
- Run harness context for the evidence-proof task spec.
- Create or update this roadmap file.
- State clearly that this file is local persistent roadmap material, not harness
  acceptance.

Forbidden work:

- Do not modify runtime code.
- Do not modify TaskLoop, provider transport, Gateway payloads,
  prompt/model-message assembly, retry, approval, rollback, completion, or
  tool-blocking behavior.
- Do not add imports, services, daemons, listeners, servers, databases,
  exporters, schedulers, or active runtime consumers.

Acceptance criteria:

- The roadmap exists and includes mission, non-drift rules, phase plan, global
  forbidden list, trigger boundary, false-block boundary, termination
  conditions, and validation notes.
- Every phase has a prompt, allowed work, forbidden work, acceptance criteria,
  required validation, and stop condition.
- The roadmap makes future Goals use this file as the single route entry point.
- The roadmap says the current phase does not enter implementation.

Required validation:

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.md`
- Manual review that only this roadmap is created or updated for this phase.
- No Vitest is required unless code or tests are changed.

Stop / termination condition:

- Stop after the roadmap is complete.
- Do not continue into Phase B in the same Goal.

### Phase B: Default-Off Preflight Proposal Spec

Goal prompt:

Create a proposal/spec/handoff for a future default-off
`destructive_operation_guard` preflight owner. Design only the future owner,
flag, rollback, false-block corpus, and boundary scan plan. Do not implement an
active guard.

Allowed work:

- Add or update a harness task spec and handoff docs for the proposal phase.
- Define an explicit default-off or disable flag.
- Define rollback proof that flag-off behavior is exactly legacy behavior.
- Define the future owner boundary as mutation-capable tool invocation
  preflight.
- Define the false-block corpus and boundary scan plan needed before any pilot.
- Update parent decision/synthesis docs only if contract semantics are being
  recorded.

Forbidden work:

- Do not implement active runtime behavior.
- Do not add imports from active runtime paths to advisory or proof helpers.
- Do not wire into TaskLoop, provider transport, Gateway, prompt assembly,
  retry, approval, rollback, completion, or tool blocking.
- Do not read live providers, execute real tools, or mutate the real workspace.

Acceptance criteria:

- The proposal explicitly states that it is design-only and not active runtime
  readiness.
- The proposal names the flag, owner, rollback path, false-block corpus, and
  active-consumer boundary scan plan.
- The proposal keeps `block` as future candidate metadata until a later
  accepted implementation spec.

Required validation:

- Run harness context for the new or updated proposal spec.
- Run harness validate for the proposal spec, using only documented fallback if
  unrelated dirty worktree state blocks diff-sensitive validation.
- Run no runtime tests unless the proposal touches code or test fixtures.

Stop / termination condition:

- Stop if the proposal requires active runtime wiring to be meaningful.
- Stop if the owner boundary cannot remain mutation-capable tool invocation
  preflight.
- Stop after design acceptance material is written; do not begin Phase C.

### Phase C: Boundary Scan And Import Contract

Goal prompt:

Prove and document the import boundary for the future active owner. Design the
allow/deny import contract that ensures only a later accepted tool invocation
preflight owner can consume active guard code.

Allowed work:

- Add or update boundary scan docs, fixtures, and focused tests if an accepted
  Phase B spec requires them.
- Define allowed import locations for a future preflight owner.
- Define denied import locations for TaskLoop, provider, Gateway, prompt
  assembly, replay, scorecard, advisory generation, retry, approval, rollback,
  completion, checkpoint, lifecycle, Electron services, and renderer code.
- Keep scans synthetic, fixture-owned, and local/dev/test-only.

Forbidden work:

- Do not connect anything to TaskLoop.
- Do not implement the active guard.
- Do not make deleted-path metadata or `block` active.
- Do not scan unbounded workspace content or persist raw runtime payloads.

Acceptance criteria:

- The boundary scan can prove that only future tool invocation preflight code is
  allowed to consume any active implementation.
- Denied roots are explicit and include active runtime, provider, Gateway,
  prompt, retry, approval, rollback, completion, checkpoint, lifecycle,
  Electron main/services, and renderer surfaces.
- The import contract states that replay, scorecard, governance, and proof code
  remain evidence producers, not active decision owners.

Required validation:

- Run harness context and harness validate for the Phase C spec.
- Run focused boundary scan tests if the accepted spec adds or updates them.
- Do not run live provider or real workspace mutation validation.

Stop / termination condition:

- Stop if the scan cannot prove exclusive future preflight ownership.
- Stop if proof requires TaskLoop, provider, Gateway, prompt, retry, approval,
  rollback, completion, checkpoint, lifecycle, or renderer consumption.
- Stop after boundary proof; do not begin Phase D.

### Phase D: Default-Off Preflight Pilot Implementation

Goal prompt:

Only after Phases B and C are accepted, implement a default-off
`destructive_operation_guard` pilot owned by mutation-capable tool invocation
preflight. Flag-off behavior must be exactly legacy behavior.

Allowed work:

- Implement only the accepted default-off preflight pilot.
- Keep the pilot limited to mutation-capable tool invocation preflight.
- Require the evidence-qualified trigger boundary before any candidate block.
- Preserve diagnostics-only metadata and provenance rules.
- Add focused tests for flag-off legacy behavior, flag-on pilot behavior,
  false-block corpus, boundary scans, and rollback proof.

Forbidden work:

- Do not change TaskLoop decisions.
- Do not change provider transport.
- Do not change Gateway payloads.
- Do not change prompt/model-message assembly.
- Do not change retry, approval, rollback, or completion behavior.
- Do not default to blocking tools.
- Do not add active consumers outside the accepted preflight owner.
- Do not write checkpoint or lifecycle authority state.

Acceptance criteria:

- The flag defaults off.
- Flag-off behavior is byte-for-behavior legacy for relevant tool invocations.
- Flag-on behavior is limited to the accepted preflight owner.
- No default block exists.
- The false-block corpus remains green.
- Boundary scans prove no other active consumer exists.
- Rollback is disabling the flag or deleting the pilot with no migration or
  state cleanup.

Required validation:

- Run harness context and harness validate for the accepted Phase D spec.
- Run focused unit tests for the pilot, false-block corpus, boundary scan, and
  rollback proof.
- Run comms validation only if the accepted implementation actually touches
  communication paths.

Stop / termination condition:

- Stop if implementation requires TaskLoop, provider, Gateway, prompt, retry,
  approval, rollback, completion, checkpoint, lifecycle, renderer, or broad
  shell-pattern ownership.
- Stop if flag-off legacy behavior cannot be proven.
- Stop if false-block risk becomes unacceptable.
- Stop after the pilot implementation; do not begin Phase E.

### Phase E: Holdout / Regression Expansion

Goal prompt:

Expand the synthetic and fixture-owned holdout corpus for
`destructive_operation_guard` false-block protection. Do not read live
providers or mutate the real workspace.

Allowed work:

- Add synthetic or fixture-owned holdout cases.
- Expand expected edit, expected deletion, normal completed repair, completed
  test repair, sanitized/inconclusive touched path, legitimate fixture mutation,
  slow test, and known dev-server-like long-running cases.
- Add regression tests for pilot flag-off and flag-on behavior if Phase D has
  been accepted.
- Record evidence gaps without expanding active runtime scope.

Forbidden work:

- Do not read live providers.
- Do not execute real workspace mutation.
- Do not broaden blocking to shell command patterns.
- Do not use deleted path metadata alone as a trigger.
- Do not promote holdout success to production/default-on readiness.

Acceptance criteria:

- The holdout corpus demonstrates continued non-blocking for expected deletion,
  slow tests, and known dev-server-like long-running metadata.
- Any active pilot remains default-off and preflight-owned.
- Evidence output remains sanitized, bounded, diagnostics/evaluation metadata
  unless a later accepted active pilot spec says otherwise for the preflight
  decision surface.

Required validation:

- Run harness context and harness validate for the Phase E spec.
- Run focused holdout/regression tests.
- Avoid broad E2E or live-provider validation unless a separate accepted spec
  requires it without violating this roadmap.

Stop / termination condition:

- Stop if holdout expansion requires real provider data or real workspace
  mutation.
- Stop if false-block regressions cannot be explained and fixed within the
  accepted owner boundary.
- Stop after holdout results are recorded; do not begin Phase F.

### Phase F: Readiness Review

Goal prompt:

Produce a readiness decision for the `destructive_operation_guard` line. Decide
whether to continue, stop, or require more evidence. Do not ship
production/default-on behavior.

Allowed work:

- Review Phases A through E and their validation evidence.
- Produce a readiness decision with explicit status and rationale.
- Record whether the line may continue, must stop, or needs more evidence.
- Record unresolved false-block, rollback, boundary, or owner risks.

Forbidden work:

- Do not implement runtime behavior.
- Do not turn the guard on by default.
- Do not approve production rollout.
- Do not use replay, scorecard, governance, evidence proof, or readiness docs as
  task completion proof.

Acceptance criteria:

- The decision states one of: continue with another accepted spec, stop the
  line, or gather more evidence.
- The decision explicitly evaluates false-block risk, flag-off legacy proof,
  preflight owner exclusivity, rollback proof, and consumer boundary proof.
- The decision preserves all global forbidden lines unless it terminates the
  route.

Required validation:

- Run harness context and harness validate for the readiness-review spec.
- Run only the evidence-producing gates required by that spec.
- Do not run live provider or real workspace mutation proof.

Stop / termination condition:

- Stop if readiness says the line is not worth entering an active pilot or
  should not continue.
- Stop if production/default-on approval is requested without a separate
  accepted release spec.
- Stop after the readiness decision; any later work needs a new Goal.

## Global Forbidden List

The whole route forbids:

- changing TaskLoop decisions
- changing provider transport
- changing Gateway payloads
- changing prompt/model-message assembly
- changing retry, approval, rollback, or completion behavior
- default tool blocking
- adding an active runtime consumer unless a future accepted spec limits it to
  tool invocation preflight
- writing checkpoint or lifecycle authority state
- reading live providers
- executing real tool mutation
- modifying the real workspace
- persisting raw prompts, provider payloads, tool args/results, secrets,
  environment dumps, or workspace content
- adding services, daemons, listeners, HTTP servers, WebSocket servers,
  databases, exporters, schedulers, always-on sidecars, second Gateways, second
  runtimes, or external transports

## Trigger Boundary

A future active trigger must require all of these signals at the same time:

- explicit default-off flag enabled
- mutation-capable tool invocation preflight owner
- deleted touched-path metadata
- `wrong_file_edit` or `unnecessary_edit` scorecard fail
- Phase 5 finding with `futureActiveCandidate.action = "block"`
- `requiresAcceptedSpec = true`
- false-block corpus still passing

Deleted touched-path metadata alone is never sufficient. Phase 5 future
candidate metadata alone is never sufficient.

## False-Block Boundary

Future work must continue protecting these non-blocking cases:

- expected edit
- expected deletion
- normal completed repair
- completed test repair
- sanitized or inconclusive touched path
- legitimate fixture mutation
- slow test command
- known dev-server-like long-running metadata

The expected-deletion case is especially important because it may observe Phase
5 future candidate metadata while still remaining non-triggering when edit
metrics pass.

## Termination Conditions

Terminate the whole route if any of these conditions becomes true:

- evidence shows false-block risk is unacceptable
- implementation requires TaskLoop, provider, Gateway, prompt, retry, approval,
  rollback, or completion changes
- implementation requires broad shell pattern blocking
- proof requires reading live providers or modifying the real workspace
- flag-off legacy behavior cannot be proven
- exclusive tool invocation preflight consumption cannot be proven
- the user explicitly terminates the route
- readiness review decides the route is not worth entering an active pilot

## Validation For This Goal

For the roadmap freeze Goal, the required validation is:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.md
```

Because this Goal creates only `next-goal-roadmap.md`, and this file is not part
of the current evidence-proof spec docs list, this document does not claim
harness acceptance. It is local persistent roadmap material. Vitest is not
required unless code or tests are changed.
