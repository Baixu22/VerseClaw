# Phase 5 Evidence Verifier Code Task Gate Limited Default-Off Readiness Spec

Status: ready_for_limited_default_off_readiness_review
Date: 2026-07-01

This handoff records the fresh limited default-off readiness package after the internal shadow observation evidence review. It is docs/spec-only. It does not implement an active code-task gate, add completion authority, change TaskLoop or Mission terminal status, add product config, persist diagnostics, add UI, touch Gateway/Main/renderer/host-api/api-client/IPC/WebSocket/provider transport, insert prompts or model messages, write checkpoint/lifecycle authority, or change retry/approval/repair/tool-policy behavior.

## Source Context

Read these files before continuing:

1. `harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation.md`
2. `harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review.md`
3. `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review/README.md`
4. `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md`
5. `openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts`
6. `tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts`
7. `tests/unit/task-loop-controller.test.ts`
8. `runtime-research/agent-runtime-index.md` Evidence Verifier section

## Phase Output

Files owned by this readiness package:

- `harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md`
- `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec/README.md`
- `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review/README.md`
- `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md`
- `runtime-research/agent-runtime-index.md`

No runtime helper, runtime wiring, test fixture, product configuration, UI, persistence, transport surface, prompt/model-message path, checkpoint/lifecycle authority, or completion decision path is added in this phase.

## Accepted Readiness Inputs

The readiness package accepts only bounded prior route evidence:

- prior Phase 5 specs and handoff decisions;
- focused validation records for the internal shadow observation and evidence-review route;
- boundary scan classifications;
- bounded internal observation/evidence-review decisions that preserve:
  - `nonAuthoritative: true`
  - `completionAuthority: false`
  - `runtimeDecisionUnaffected: true`
  - `legacyDecisionUnaffected: true`
  - `activePilotRequiresFreshSpec: true`

The readiness package must not consume raw transcripts, raw logs, raw workspace scans, raw model prompts/messages, provider transport, Gateway/Main/renderer data, DB handles, files, sidecars, secrets, auth material, tool args/output, raw samples, or replayed side effects.

## Decision Matrix

The readiness decision may be only one of:

- `stop_or_freeze_route`
- `continue_internal_shadow_observation_hardening`
- `ready_for_limited_default_off_readiness_review`

| Evidence condition | Decision |
|---|---|
| Missing predecessor evidence-review package, missing accepted authority fields, or contradictory prior decision | `stop_or_freeze_route` |
| Any output grants completion authority, changes runtime decision, changes legacy decision, omits active-pilot fresh-spec requirement, or approves active enforcement | `stop_or_freeze_route` |
| Any readiness input reads files, logs, transcripts, workspace, configuration, global state, DB handles, Gateway/Main/renderer/provider transport, prompts, or model messages | `stop_or_freeze_route` |
| Any UI, product config, persistence, service/listener/daemon, transport, checkpoint/lifecycle authority, prompt/model-message insertion, or default-on behavior is added | `stop_or_freeze_route` |
| Required evidence exists but validation or boundary scan classification is incomplete | `continue_internal_shadow_observation_hardening` |
| Fresh spec/docs/index are complete, validation passes, scans are classified, README translations require no user-visible update, and all authority fields remain non-authoritative | `ready_for_limited_default_off_readiness_review` |

## Entry Tightening Strategy

This route now has only three exits:

- `ready_for_limited_default_off_readiness_review`
- `continue_internal_shadow_observation_hardening`
- `stop_or_freeze_route`

`ready_for_limited_default_off_readiness_review` is documentation and validation review only. It does not create or imply an active-pilot entry. `continue_internal_shadow_observation_hardening` is the only investment path when shadow evidence needs more quality work. `stop_or_freeze_route` is mandatory if progress depends on raw transcripts/logs/workspace scans, persistence, services, transport, prompts/model messages, product config, UI, checkpoint/lifecycle authority, completion authority, or default-on behavior.

## Shadow Evidence Investment Strategy

Continue investing only in evidence quality that stays bounded and diagnostic:

- expand synthetic/offline fixture coverage and focused unit coverage;
- preserve separate false-block causes, especially missing capture, local test not required, external validation not represented, report-shape drift, and truly missing validation;
- preserve separate false-allow risk labels, especially semantic-risk false allows;
- improve boundary scan classification and rollback proof;
- keep all evidence caller-owned, in-memory, diagnostic-only, non-authoritative, and excluded from task-completion proof.

Do not invest in productization or authority until a later fresh spec has stronger runtime shadow evidence and explicit low-risk enforcement boundaries.

## Shadow Evidence Quality Hardening Follow-Up

The first concrete investment slice is recorded at `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening/README.md` with spec `harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening.md`.

That follow-up adds only a pure caller-owned in-memory quality report helper for existing evaluation, runtime replay readiness, and internal observation reports. It preserves the same three-entry route: readiness review, continued hardening, or route freeze. It does not add active enforcement, completion authority, product config, persistence, UI, transport, prompt/model-message insertion, checkpoint/lifecycle authority, or default-on behavior.

## Deep Test Gate

The deep test for this route is intentionally focused:

- harness context and no-diff validation for this readiness spec;
- focused Evidence Verifier and TaskLoop seam units;
- deeper Evidence Verifier units covering shadow, offline corpus, contracts, collectors, and TaskLoop controller;
- diff/whitespace checks;
- forbidden active-authority, transport, persistence/service/command, and self-scans.

This deep test must not start a service, listener, daemon, Gateway, Electron app, provider transport, transcript reader, log reader, DB-backed collector, persistence surface, or workspace sampler. Passing deep test may support only readiness review or continued hardening; it does not approve active enforcement.

## Phase Decision

Decision: `ready_for_limited_default_off_readiness_review`.

This decision allows only review of this limited default-off readiness package. It does not approve active enforcement, default enablement, runtime cutover, completion blocking, TaskLoop/Mission terminal-state changes, Gateway/Main/renderer/host-api/api-client/IPC/WebSocket/provider transport changes, persistence, UI, product config, prompt/model-message insertion, checkpoint/lifecycle authority, retry/approval/repair/tool-policy changes, or completion proof from diagnostics.

## Rollback

Rollback remains docs-only:

1. Reject this readiness package or decline readiness-review entrance.
2. Keep the internal shadow observation evidence-review decision as the last accepted Phase 5 state.
3. Stop using internal observation/evidence-review summaries as readiness input.
4. Default TaskLoop behavior remains unchanged.

No schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client rollback, prompt rollback, checkpoint rollback, lifecycle rollback, or TaskLoop behavior rollback is required.

## Docs Sync

Root README translations were reviewed for this phase. No `README.md`, `README.zh-CN.md`, or `README.ja-JP.md` update is required because this phase changes only internal harness specs and research handoff documentation. It does not change product behavior, user-visible UI, public API, runtime configuration, release-facing behavior, or user workflows.

## Validation Results

`rtk` was unavailable in this worktree (`Get-Command rtk` returned no command), so the required validation was run directly.

Passed:

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md`
  - Result: passed; context included the gateway/backend communication boundary rules as expected.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md --no-diff`
  - Result: passed; spec is valid.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/task-loop-controller.test.ts`
  - Result: passed; 2 files passed, 103 tests passed.
- Deeper focused unit gate:
  - `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/task-loop-controller.test.ts`
  - Result: passed; 5 files passed, 120 tests passed.
- `git diff --check -- harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec/README.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review/README.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md runtime-research/agent-runtime-index.md`
  - Result: passed for tracked touched files; Git warned that `runtime-research/agent-runtime-index.md` line endings may be normalized by Git later.
- `rg -n "[ \t]+$" harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec/README.md`
  - Result: no trailing-whitespace matches for new/untracked docs.
- `rg -n "Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" ...`
  - Result: hits are hard-boundary documentation, required scan command text, and existing runtime index historical entries only.
- `rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|spawn|exec\\(|vitest|eslint|tsc|pnpm|readFile|transcript|log|database|cache|service|listener|daemon|sidecar|exporter|collector" ...`
  - Result: hits are hard-boundary documentation, required validation command text, and existing runtime index historical entries only.
- `rg -n "active pilot approved|active enforcement approved|completionAuthority:\\s*true|default-on verifier gate|default enablement|reviewer prompt insertion|model-message insertion" ...`
  - Result: hits are hard-boundary documentation, required scan command text, and existing runtime index historical entries only. No true completion-authority field hit was present in the new readiness spec/handoff.
- Self-scan for active-readiness wording and true completion-authority field values in the new readiness spec/handoff.
  - Result: no matches.

`pnpm run comms:replay` and `pnpm run comms:compare` are not required unless a later edit touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, provider transport, or other communication paths.

## Boundary Classification

Fresh scans are classified.

- Active-authority scan hits are hard-boundary documentation, required scan command text, and existing runtime index historical entries only. No runtime helper/wiring code was changed in this phase.
- Transport scan hits are hard-boundary documentation, required scan command text, and existing runtime index historical entries only. No Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, or provider transport surface was added.
- Persistence/service/command scan hits are hard-boundary documentation, required validation command text, and existing runtime index historical entries only. No persistence, DB/cache, service/listener/daemon, sidecar/exporter/collector, command execution, transcript/log read, or workspace scan behavior was added.
- Readiness spec/handoff self-scan found no active-readiness token and no true completion-authority field value.
- Deep-test boundary classification is unchanged after entry tightening: the added strategy text is documentation-only and does not add runtime/helper implementation surfaces.

Any future code hit in runtime helper/wiring files for transport, persistence, service/listener, prompt/model-message insertion, command execution, active authority, or completion authority must block the phase.

## Next Step

The next allowed step is readiness review of this limited default-off package, continued internal shadow observation hardening, or freezing the route. Active enforcement remains blocked until a separate fresh spec is accepted with stronger runtime shadow evidence and explicit low-risk enforcement boundaries.
