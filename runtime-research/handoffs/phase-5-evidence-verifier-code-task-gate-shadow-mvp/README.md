# Phase 5 Evidence Verifier Code Task Gate Shadow MVP

Status: implemented_shadow_mvp

## Scope

This slice adds the smallest measurement base for a possible future standalone code-task Evidence Verifier completion sanity gate:

```text
legacy terminal task metadata + optional EvidenceVerifierReport
  -> code-task gate shadow report
  -> aggregate risk/benefit counters
  -> labeled offline capability metrics
  -> three-stage readiness checks
```

The MVP is explicitly non-authoritative. It reports what a future low-power completion sanity gate would do for a legacy-completed code-edit task, but it does not block completion, change TaskLoop or Mission status, execute validators, collect evidence, persist data, or expose a product surface.

## Implemented

- Runtime-core helper `buildCodeTaskEvidenceGateShadowReport`.
- Runtime-core helper `summarizeCodeTaskEvidenceGateShadowReports`.
- Runtime-core helper `buildCodeTaskEvidenceGateShadowSamplerEvent`.
- Runtime-core helper `summarizeCodeTaskEvidenceGateShadowSamplerEvents`.
- Runtime-core helper `buildCodeTaskEvidenceGateRuntimeCallerResult`.
- Runtime-core helper `summarizeCodeTaskEvidenceGateRuntimeCallerResults`.
- Runtime-core helper `buildCodeTaskEvidenceGateRuntimeShadowProducerResult`.
- Runtime-core helper `buildCodeTaskEvidenceGateRuntimeShadowCollectionResult`.
- Runtime-core helper `buildCodeTaskEvidenceGateInternalShadowObservationResult`.
- Runtime-core helper `evaluateCodeTaskEvidenceGateRuntimeReplaySamples`.
- Runtime-core helper `evaluateCodeTaskEvidenceGateRuntimeReplayReadiness`.
- Runtime-core helper `evaluateCodeTaskEvidenceGateShadowSamples`.
- Runtime-core helper `evaluateCodeTaskEvidenceGateReadiness`.
- Closed task-kind, legacy-status, shadow-decision, block-reason, and diagnostic-code taxonomies.
- Closed manual-review labels and evaluation outcomes.
- Closed readiness stages for `offline_corpus`, `shadow_sampler`, and `active_pilot`.
- `would_allow` only for legacy-completed code-edit tasks with a completed `EvidenceVerifierReport`.
- `would_block` for legacy-completed code-edit tasks with missing, failed, blocked, cancelled, or insufficient verifier reports.
- `not_applicable` for non-code tasks and non-completed legacy terminal states.
- `invalid_input` for malformed shadow input or task-id drift between the task and verifier report.
- Labeled offline sample evaluation for `useful_block`, `false_block`, `false_allow`, `true_allow`, `inconclusive`, and `not_evaluated`.
- Readiness checks for corpus coverage, useful-block precision/recall, false-block/false-allow rates, inconclusive rate, missing-report share, and active-pilot runtime shadow evidence.
- Focused unit tests for allow, block, missing report, non-applicable, invalid input, aggregate summary, labeled evaluation behavior, and the three readiness stages.
- A 120-sample representative offline corpus test that quantifies the first three offline iterations before runtime integration.
- Shadow-only evidence-capture issue diagnostics for false-block analysis: `truly_missing_validation`, `validation_done_but_not_captured`, `external_validation_not_represented`, `local_test_not_required`, and `report_task_id_or_shape_issue`.
- Shadow-only allow-risk tagging for completed verifier reports with semantic-risk signals: `evidence_diff_mismatch`, `weak_test_coverage`, `changed_files_not_represented`, `obligation_not_mapped_to_evidence`, and `semantic_regression_risk`.
- A default-off sampler event contract that returns `not_sampled` unless `mode: "shadow_only"` is explicitly supplied.
- A sampler summary contract for sampled/not-sampled counts, shadow decisions, risk tiers, false-block causes, diagnostic codes, and non-authoritative/no-completion-authority proof.
- A pure runtime-shaped caller adapter that defaults to disabled, does not require valid shadow input while disabled, and calls the sampler only in explicit `shadow_only` mode.
- A default-off real-runtime-shaped shadow producer adapter that emits only caller-owned diagnostics and calls the runtime caller adapter only in explicit `shadow_only` mode.
- A limited default-off runtime shadow collection helper that bounds caller-supplied in-memory samples and feeds accepted producer caller inputs into replay/readiness diagnostics.
- A pure runtime-shaped replay/readiness helper that consumes only caller-supplied in-memory samples and labels.
- A controlled default-off TaskLoop runtime shadow wiring point that emits bounded collection diagnostics only through an injected in-memory sink.
- A limited default-off internal shadow observation helper that consumes only caller-supplied in-memory collection results and existing replay/readiness helpers.

## Boundary

The helper is pure, in-memory, deterministic, bounded, and explicit-call only.

It does not invoke TaskLoop, Mission, Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, prompt/model-message insertion, patch apply, workspace edit, symbol mutation, persistence, database, cache, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, command execution, lint, typecheck, tests, diagnostics, or workspace scans.

`would_allow`, `would_block`, and aggregate summary output are shadow diagnostics only. They are not task-completion evidence and do not approve active verifier enforcement.

The sampler event helper follows the same boundary. Disabled/default mode does not build a shadow report. Explicit `shadow_only` mode only returns bounded diagnostic fields copied from the pure shadow report plus sampler non-authority fields:

- `nonAuthoritative: true`.
- `completionAuthority: false`.
- `retention: caller_owned_non_persistent`.
- `legacyDecisionUnaffected: true`.

The runtime-shaped caller adapter and replay helpers also follow the same boundary. They do not subscribe to runtime events, read logs/transcripts, scan the workspace, persist data, or mutate runtime state. Disabled/default caller mode does not call the sampler and does not require valid shadow input. Replay readiness is computed only from caller-supplied in-memory samples and labels.

The real-runtime-shaped producer adapter follows the same boundary. It is still pure runtime-core code, not TaskLoop/Gateway wiring. Disabled/default producer mode does not call the caller adapter or sampler and does not require valid completion metadata, valid shadow input, or a verifier report. Explicit `shadow_only` mode calls only `buildCodeTaskEvidenceGateRuntimeCallerResult(...)`, returns bounded diagnostic fields, and keeps `nonAuthoritative: true`, `completionAuthority: false`, `runtimeDecisionUnaffected: true`, and `legacyDecisionUnaffected: true`.

The limited collection helper follows the same boundary. Disabled/default collection mode does not call the producer/caller/sampler path and does not require valid samples, completion metadata, shadow input, readiness thresholds, or verifier reports. Explicit `shadow_only` mode calls only `buildCodeTaskEvidenceGateRuntimeShadowProducerResult(...)` for caller-supplied in-memory samples up to the configured sample limit, then uses existing replay/readiness helpers on accepted producer-owned caller inputs. Collection output remains caller-owned, non-persistent, non-authoritative diagnostics.

The controlled TaskLoop wiring is narrower than product/runtime configuration. It is a deps-only seam on `runTaskLoop(...)`: omitted mode and explicit `disabled` are no-ops, and even an injected sink is ignored unless `codeTaskEvidenceGateRuntimeShadowCollectionMode: "shadow_only"` is supplied. In `shadow_only`, TaskLoop builds a single runtime-shaped completion sample from already-available loop metadata, optional shadow verifier report, and bounded evidence-gate counts, then calls only `buildCodeTaskEvidenceGateRuntimeShadowCollectionResult(...)`. The result is delivered only to `codeTaskEvidenceGateRuntimeShadowCollectionSink`; it is not stored on the run record, checkpointed, emitted through lifecycle events, inserted into prompts/model messages, persisted, or treated as completion evidence. Builder or sink failures are swallowed so TaskLoop completion remains authoritative and unchanged.

The internal observation helper follows the same boundary. Disabled/default observation mode does not require valid collections and does not inspect collection contents. Explicit `shadow_only` mode accepts only caller-supplied in-memory `CodeTaskEvidenceGateRuntimeShadowCollectionResult` values, bounds them by `maxCollections`, extracts only their in-memory replay samples and summary counters, and feeds those replay samples to `evaluateCodeTaskEvidenceGateRuntimeReplaySamples(...)` plus `evaluateCodeTaskEvidenceGateRuntimeReplayReadiness(...)`. Observation output is limited to bounded counts, diagnostic codes, replay/readiness signals, and one internal review decision. It does not read runtime state, files, logs, transcripts, workspace contents, configuration, or global state. It does not write files, DB rows, cache entries, checkpoints, lifecycle payloads, prompts, model messages, UI state, or product config.

## Adjusted Target

The first offline corpus changed the route target. This work should not be treated as a path toward a default-on code correctness judge. Its realistic target is narrower:

- prevent obviously unverified, failed, or evidence-broken code tasks from looking clean;
- produce a stable risk layer around task completion quality;
- expose evidence-capture gaps before they become runtime policy;
- remain low-authority, default-off, and easy to disable at every stage.

It should not try to prove semantic correctness by itself, replace tests/review/static analysis, or become an active completion authority without strong runtime shadow evidence.

## Risk Evaluation Use

The route has now completed the first evidence-quality offline loop and one controlled TaskLoop-adjacent runtime shadow wiring slice. The useful next step is still not Gateway/Main/renderer wiring, UI, persistence, product configuration, or an active gate; it is limited default-off internal observation only if the implementation boundary and validation gates stay clean:

- keep the runtime-core helpers pure, deterministic, in-memory, and explicit-call only;
- keep the TaskLoop seam deps-only, omitted/disabled by default, and sink-owned;
- treat `risky_allow` as a diagnostic label, not proof of semantic correctness;
- design any future sampler as default-off, low-authority, rollback-by-stop-calling, and write no persistent policy from this helper;
- keep active pilot blocked until runtime shadow evidence exists and active-pilot thresholds are substantially stronger.

The MVP includes the metric shape needed for that comparison: block precision, block recall, useful-block count, false-block count, false-allow count, and true-allow count. Those values are meaningful only when samples are labeled by a reviewer or trusted offline oracle.

The three readiness stages are intentionally staged, but progression is now stricter after the first offline result:

- `offline_corpus`: checks that enough labeled offline samples and gate candidates exist.
- `shadow_sampler`: requires improved offline evidence first, especially lower false-block rate and better missing-report classification, before any runtime sampler work should begin.
- `active_pilot`: requires runtime shadow evidence, stricter precision/recall and false-rate thresholds, and must be limited to low-dispute block reasons if it is ever attempted.

No active gate should be considered until shadow samples show a favorable useful-block to false-block ratio and a rollback path remains a single disable/stop-calling action.

## Offline Corpus Result

Current representative offline corpus after the three offline iterations:

- Total samples: 120.
- Gate candidates: 104.
- Evaluated candidates with decisive manual labels: 96.
- Not evaluated: 16 non-code or non-completed legacy cases.
- Inconclusive: 8 reviewer-uncertain samples.
- True allow: 43.
- Useful block: 32.
- False block: 7.
- False allow: 14.
- Shadow would allow: 61.
- Shadow would block: 43.
- Block precision: 32 / 39 = 82.1%.
- Block recall: 32 / 46 = 69.6%.
- False-block rate among decisive blocked outcomes: 7 / 39 = 17.9%.
- False-allow rate among decisive allowed outcomes: 14 / 57 = 24.6%.
- Useful-block to false-block ratio: 32 / 7 = 4.57:1.
- Risky false allows: 10 / 14 = 71.4%.
- Missing verifier report blocks: 10.
- Verifier failed blocks: 6.
- Verifier blocked blocks: 4.
- Verifier cancelled blocks: 4.
- Insufficient evidence blocks: 19.

False-block source split:

- `truly_missing_validation`: 1.
- `validation_done_but_not_captured`: 1.
- `external_validation_not_represented`: 1.
- `local_test_not_required`: 3.
- `report_task_id_or_shape_issue`: 1.

Stage decisions from the same corpus:

- `offline_corpus`: ready. The helper supports offline evaluation and threshold tuning.
- `shadow_sampler`: ready for a future default-off runtime shadow sampler design. This is not runtime wiring and does not authorize active enforcement.
- `active_pilot`: blocked. There is no explicit runtime shadow evidence, and the active-pilot false-block and missing-report thresholds remain stricter than the offline result.

Interpretation: the helper now has enough labeled offline evidence to justify designing a default-off runtime shadow sampler, provided the sampler remains non-authoritative and separately specified. It is still not a code correctness judge and still cannot prove semantic completion. Four false allows remain clean-looking because the available report fields do not encode enough diff/obligation semantics; that limitation should be preserved rather than hidden.

## Sampler Contract Result

The default-off sampler route is implemented as pure runtime-core helpers only:

- `buildCodeTaskEvidenceGateShadowSamplerEvent(input)`.
- `summarizeCodeTaskEvidenceGateShadowSamplerEvents(events)`.
- `buildCodeTaskEvidenceGateRuntimeCallerResult(input)`.
- `summarizeCodeTaskEvidenceGateRuntimeCallerResults(results)`.
- `buildCodeTaskEvidenceGateRuntimeShadowProducerResult(input)`.
- `buildCodeTaskEvidenceGateRuntimeShadowCollectionResult(input)`.
- `evaluateCodeTaskEvidenceGateRuntimeReplaySamples(samples)`.
- `evaluateCodeTaskEvidenceGateRuntimeReplayReadiness(report)`.

The event builder is deliberately default-off:

- missing `mode` or `mode: "disabled"` returns `outcome: "not_sampled"` and does not evaluate the shadow report;
- `mode: "shadow_only"` evaluates the existing pure shadow helper and copies only bounded summary fields into the sampler event;
- invalid sampler input returns `outcome: "invalid_input"` and `sampled: false`;
- every event states `completionAuthority: false` and `retention: "caller_owned_non_persistent"`.

This closes the contract design part of the sampler route. It still does not wire TaskLoop, Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, persistence, service/listener/daemon behavior, active gates, or default-on behavior.

## Runtime Shadow Producer Result

The route now includes a minimal default-off producer adapter for real-runtime-shaped completion metadata:

- default/missing `mode` returns `outcome: "disabled"`, `sampled: false`, and no caller result;
- disabled mode does not require valid completion metadata, valid shadow input, or a valid verifier report;
- explicit `shadow_only` mode requires bounded completion metadata plus sampler identifiers, then delegates only to the pure runtime caller adapter;
- valid completion produces a sampled diagnostic result;
- missing verifier reports and insufficient verifier evidence produce `runtime_shadow_producer_would_block` diagnostics only;
- semantic-risk completions produce `runtime_shadow_producer_risky_allow` diagnostics only;
- invalid explicit producer input fails closed as `outcome: "invalid_input"` with no completion authority.

Producer output can be shaped into the existing runtime replay/readiness helper through its caller-owned `callerInput`, but replay readiness still returns only shadow evidence review readiness and records `runtime_replay_active_pilot_still_requires_fresh_spec`. This is not active completion authority and does not approve runtime enforcement.

## Runtime Shadow Collection Result

The route now includes a minimal bounded collection helper for caller-supplied runtime-like samples:

- default/missing `mode` returns `outcome: "disabled"`, no entries, and no producer/caller/sampler invocation;
- disabled mode does not require valid samples, sample limits, readiness thresholds, completion metadata, shadow input, or verifier reports;
- explicit `shadow_only` mode requires an in-memory `samples` array and a valid optional `maxSamples`;
- the default sample limit is 20 and explicit limits are bounded to positive integers at or below 1000;
- samples beyond the limit are dropped from processing and counted in `droppedSampleCount`;
- accepted samples call only the existing producer adapter;
- accepted producer-owned caller inputs can be replayed through existing runtime replay/readiness helpers;
- replay readiness still records `runtime_replay_active_pilot_still_requires_fresh_spec`;
- invalid explicit collection input fails closed as `outcome: "invalid_input"` with no completion authority.

The focused collection fixture used by tests has four requested samples, three accepted samples, one dropped sample, three sampled producer results, one useful block, one false block, one risky false allow, and replay readiness `ready_for_shadow_evidence_review` only under lowered test thresholds. This proves the helper can collect bounded shadow diagnostics, not that active enforcement is safe.

## Controlled Runtime Shadow Wiring Result

The route now includes the smallest controlled runtime wiring around real TaskLoop completion metadata:

- default/omitted mode does not call the collection builder, producer, caller, sampler, or sink;
- explicit `shadow_only` plus an injected sink emits one bounded in-memory collection result after TaskLoop sets its legacy `complete` status;
- the completion sample uses only caller-owned metadata: loop run id, session key, iteration, status, optional shadow verifier report, evidence-gate status, touched-file count, test count, and a bounded changed-file list;
- collection results keep `nonAuthoritative: true`, `completionAuthority: false`, `runtimeDecisionUnaffected: true`, and `legacyDecisionUnaffected: true`;
- invalid explicit collection options fail closed into an `invalid_input` diagnostic result when the builder can return one;
- builder/sink exceptions are isolated from TaskLoop and cannot change the terminal status;
- the collection marker is absent from checkpoint and lifecycle payloads.

This is not product config, not default-on behavior, and not a runtime policy surface. It is only a controlled in-memory diagnostic hook for future evidence accumulation.

## Internal Shadow Observation Result

The route now includes the limited internal observation package requested after controlled TaskLoop wiring:

- default/omitted observation mode returns `outcome: "disabled"` and does not require valid collection results;
- explicit `shadow_only` consumes only injected, caller-owned, in-memory collection results;
- accepted collections are bounded by `maxCollections` with dropped collections counted, not scanned or persisted;
- the helper aggregates collection counts, sampled counts, replay sample counts, would-block counts, and risky-allow counts;
- replay samples from accepted collections are evaluated through the existing runtime replay/readiness helpers;
- observation output keeps `nonAuthoritative: true`, `completionAuthority: false`, `runtimeDecisionUnaffected: true`, `legacyDecisionUnaffected: true`, and `activePilotRequiresFreshSpec: true`;
- the only phase decisions are `ready_for_limited_default_off_internal_shadow_observation_review`, `continue_internal_shadow_observation_hardening`, and `stop_or_freeze_route`;
- invalid explicit observation input fails closed as `stop_or_freeze_route`.

Focused TaskLoop tests now simulate multiple explicit `shadow_only` runs with an injected in-memory sink, covering a valid completion, a missing-evidence `would_block`, and a semantic-risk `risky_allow` sample. The collected in-memory results are then passed to the observation helper. The same focused tests prove default disabled mode does not call builder/sink, checkpoint and lifecycle JSON do not contain the collection marker, invalid explicit collection input does not alter completion, and builder/sink exceptions do not affect the TaskLoop terminal result.

This is only internal shadow observation/evidence accumulation. It does not authorize active pilot, default enablement, completion blocking, product configuration, persistence, UI, Gateway/Main/renderer/host-api/api-client/IPC/WebSocket/provider transport changes, prompt/model-message insertion, checkpoint authority, lifecycle authority, or any change to TaskLoop/Mission terminal status.

## Internal Shadow Observation Evidence Review

The next review package is now recorded at `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review/README.md`.

That review is docs/spec-only. It consumes only bounded internal observation output and validation records from this route. It does not add a new runtime helper, read raw transcripts/logs/workspace state, persist data, add UI/product config, touch Gateway/Main/renderer/host-api/api-client/IPC/WebSocket/provider transport, insert prompts/model messages, write checkpoint/lifecycle authority, or change TaskLoop/Mission terminal status.

The review decision is `ready_for_limited_default_off_readiness_spec`. This permits only a later fresh readiness-spec package. It does not approve active pilot, default enablement, completion blocking, runtime cutover, persistence, UI, product config, transport changes, prompt/model-message insertion, or completion proof from diagnostics.

## Limited Default-Off Readiness Spec

The fresh readiness package after the evidence review is now recorded at `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec/README.md`.

That readiness package is docs/spec-only. It accepts only prior Phase 5 specs, handoff decisions, validation records, boundary scan classifications, and bounded internal observation/evidence-review decisions. It preserves `nonAuthoritative: true`, `completionAuthority: false`, `runtimeDecisionUnaffected: true`, `legacyDecisionUnaffected: true`, and `activePilotRequiresFreshSpec: true`.

The readiness decision is `ready_for_limited_default_off_readiness_review`. This permits only review of the limited default-off readiness package. It does not approve active pilot, default enablement, completion blocking, runtime cutover, persistence, UI, product config, transport changes, prompt/model-message insertion, checkpoint/lifecycle authority, or completion proof from diagnostics.

## Shadow Evidence Quality Hardening

The first investment slice after entry tightening is recorded at `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening/README.md`.

That slice adds `buildCodeTaskEvidenceGateShadowEvidenceQualityReport(...)`, a pure in-memory quality report helper over existing evaluation, runtime replay readiness, and internal observation reports. The helper can recommend only `ready_for_limited_default_off_readiness_review`, `continue_internal_shadow_observation_hardening`, or `stop_or_freeze_route`; it keeps `nonAuthoritative: true`, `completionAuthority: false`, `runtimeDecisionUnaffected: true`, `legacyDecisionUnaffected: true`, and `activePilotRequiresFreshSpec: true`.

The helper is an investment tool for shadow evidence quality. It does not approve active pilot, default enablement, completion blocking, runtime cutover, persistence, UI, product config, transport changes, prompt/model-message insertion, checkpoint/lifecycle authority, or completion proof from diagnostics.

## Runtime-Shaped Replay Result

The route now includes a pure runtime-shaped caller/replay closure:

- caller adapter disabled/default mode returns `outcome: "disabled"` and does not sample;
- explicit `shadow_only` caller mode can produce a bounded sampler event;
- caller summaries preserve `completionAuthorityCount: 0`;
- replay reports evaluate caller-supplied labels into `true_allow`, `useful_block`, `false_block`, `false_allow`, `inconclusive`, and `not_evaluated`;
- replay readiness can return `ready_for_shadow_evidence_review`, but it always records that active pilot still requires a fresh accepted spec.

The focused replay fixture used by tests has 20 runtime-shaped samples, 18 sampled cases, 18 evaluated candidates, block precision 5 / 6 = 83.3%, false-block rate 1 / 6 = 16.7%, false-allow rate 2 / 12 = 16.7%, useful-block to false-block ratio 5:1, and risky false-allow share 2 / 2 = 100%. This is sufficient for shadow evidence review only; it is not active-pilot evidence.

## Forward Thresholds

Recommended progression thresholds after this result:

- Do not start a runtime shadow sampler unless the labeled corpus stays at or above 100 samples, block precision stays at least 80%, false-block rate stays at most 20%, false-allow rate stays at most 25% or most false allows are tagged risky, and useful-block to false-block ratio stays at least 4:1.
- Treat the current result as sufficient only for a default-off runtime shadow sampler, not an active gate.
- Preserve the false-block split so valid tasks without local tests or with external validation are not collapsed into broad insufficient-evidence noise.
- Preserve semantic-risk tagging and explicitly report clean-looking false allows as a current limitation when report metadata is too weak.
- Do not start an active pilot until runtime shadow evidence reaches at least 300-500 samples, useful-block to false-block ratio is at least 5:1, block precision is 85-90%, and false-block rate is at most 10-15%.
- If an active pilot is ever attempted, limit it first to low-dispute reasons such as explicit verifier failure or tool/test failure, not broad insufficient-evidence cases.

## Validation

Focused validation used for this MVP:

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-mvp.md`
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-mvp.md --no-diff`
- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-shadow-sampler-readiness.md`
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-shadow-sampler-readiness.md --no-diff`
- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-shadow-sampler-implementation.md`
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-shadow-sampler-implementation.md --no-diff`
- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-runtime-shadow-evidence-replay-readiness.md`
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-runtime-shadow-evidence-replay-readiness.md --no-diff`
- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-real-runtime-shadow-producer.md`
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-real-runtime-shadow-producer.md --no-diff`
- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-runtime-shadow-collection.md`
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-runtime-shadow-collection.md --no-diff`
- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-controlled-default-off-runtime-shadow-wiring.md`
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-controlled-default-off-runtime-shadow-wiring.md --no-diff`
- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation.md`
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation.md --no-diff`
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts`
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/task-loop-controller.test.ts`
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/task-loop-controller.test.ts`
- `git diff --check -- openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-mvp.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md`
- Boundary scans for forbidden runtime integration patterns.

## Next Phase

Future work remains a separate accepted task spec:

```text
code-task gate shadow MVP
  -> larger labeled offline corpus and evidence-capture repair
  -> threshold retest and sampler-readiness decision
  -> default-off sampler event/summary contract helper
  -> pure default-off runtime-shaped caller adapter
  -> pure runtime-shaped replay/readiness helper
  -> default-off real-runtime-shaped shadow producer adapter
  -> limited default-off runtime shadow collection helper
  -> controlled default-off TaskLoop runtime shadow wiring with injected in-memory sink
  -> limited default-off internal shadow evidence observation/review
  -> limited default-off readiness-spec package
  -> shadow evidence quality hardening
  -> limited default-off readiness review / continued hardening / route freeze
  -> limited active pilot only in a still-later fresh spec after real default-off runtime shadow evidence proves low false-block risk
```

Any Gateway/Main/renderer consumer, product config, persistence, UI, active enforcement flag, provider transport change, prompt/model-message insertion, service/listener/daemon behavior, default-on behavior, or promotion of diagnostics into completion authority requires a fresh accepted spec.

Current next decision: `ready_for_limited_default_off_readiness_review`. This is not active-pilot readiness, and it must not be used to enable a default-on or active completion gate.
