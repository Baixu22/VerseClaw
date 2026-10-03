---
id: token-dense-recovery-compression-v1
title: Token-dense recovery compression v1
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Upgrade session compaction from legacy string summaries to structured, evidence-aware recovery artifacts that can seed the next prompt or handoff without rereading the full transcript.
touchedAreas:
  - openclaw_runtime/packages/agent-core/src/harness/compaction/**
  - openclaw_runtime/src/agents/agent-hooks/**
  - openclaw_runtime/src/agents/embedded-agent-runner/**
  - openclaw_runtime/src/context-engine/cvk/**
  - openclaw_runtime/src/context-engine/context-orchestrator.ts
  - openclaw_runtime/src/context-engine/context-orchestrator.test.ts
  - openclaw_runtime/src/observability/deprecation-counters.ts
  - openclaw_runtime/src/observability/deprecation-counters.test.ts
  - openclaw_runtime/packages/gateway-protocol/src/**
  - openclaw_runtime/src/gateway/server-methods/**
  - openclaw_runtime/src/gateway/session-compaction-checkpoints.ts
  - openclaw_runtime/src/config/sessions/types.ts
  - openclaw_runtime/src/config/types.agent-defaults.ts
  - electron/services/sessions-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/pages/Chat/**
  - shared/i18n/locales
  - docs/clawx-design-overview.md
  - scripts/context-compression-eval-runner.mjs
  - scripts/context-compression-production-summary-regenerator.ts
  - scripts/context-compression-recovery-ledger.mjs
  - scripts/context-compression-would-retry-canary.ts
  - scripts/context-compression-would-retry-local-manifest.mjs
  - scripts/context-compression-deterministic-recovery-batch.mjs
  - tests/unit/context-compression-eval.test.ts
  - tests/unit/context-compression-provider.test.ts
  - tests/unit/compression-artifact.test.ts
  - tests/unit/context-runtime-kit-recovery-context.test.ts
  - tests/unit/helpers/context-compression-eval.ts
  - tests/unit/performance-budgets.test.ts
  - reports/context-compression/**
  - reports/CONTEXT-COMPRESSION-DEVELOPMENT-PLAN-2026-08-17.md
  - artifacts/context-compression-baseline/**
  - harness/specs/tasks/token-dense-recovery-compression-v1.md
  - harness/specs/tasks/a5-adaptive-context-budget-pilot.md
expectedUserBehavior:
  - Manual and automatic compaction preserve a structured CompressionArtifact when available.
  - Existing summary/history consumers keep working through the rendered legacy summary.
  - Chat can show compaction quality, score, evidence coverage, unverified count, and projected recovery tokens.
  - Handoff uses recoveryContext before falling back to checkpoint/transcript-only continuation.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/context-compression-provider.test.ts --reporter=verbose
  - pnpm exec vitest run tests/unit/compression-artifact.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts tests/unit/chat-input.test.tsx --reporter=verbose
  - pnpm exec vitest run tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts packages/gateway-protocol/src/schema/sessions.recall.test.ts packages/agent-core/src/harness/compaction/compression-artifact.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit-fast.config.ts src/agents/agent-hooks/compaction-damage-rules.test.ts src/agents/agent-hooks/compaction-addressability.test.ts src/agents/embedded-agent-runner/run/preemptive-compaction.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/agent-hooks/compaction-validated-pipeline.test.ts src/agents/embedded-agent-runner/run/manual-compaction.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts packages/agent-core/src/harness/compaction/compression-planner.test.ts src/context-engine/context-orchestrator.test.ts src/observability/deprecation-counters.test.ts --reporter=verbose
  - pnpm harness validate --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - The offline CLI resolves its real entry path through workspace junctions; importing its provider helper does not run the CLI, and invoking an aliased CLI path must produce a report rather than a silent exit 0.
  - L0 checks the original quotes behind stitched objective reports; derived pending-objective control text remains required in L1 without pretending that its generated wording occurred verbatim in the transcript.
  - Offline live evaluators accept an explicit COMPACTION_API_FORMAT=responses using the Responses input/text contract, normalize output_text for existing scoring, and reject incomplete, refused, or empty results without weakening quality thresholds; the default Chat Completions path remains compatible.
  - Runtime compaction details include artifact/quality metrics or deterministic fallback warnings.
  - Gateway exposes sessions.compressionArtifact and sessions.recoveryContext through formal protocol validators.
  - Renderer calls only Host API facade methods; it does not read transcripts or call Gateway directly.
  - Quality gates surface warnings instead of silently presenting low-evidence compression as high confidence.
  - P0 eval runner records unreadable transcript-tree junctions as skipped inputs instead of aborting sample collection.
  - P0 manifests record version, manifest digest, transcript inventory hash, model ids, prompt versions, run parameters, and fixed provider/pressure/turn-count/split-turn/previous-summary/file-hunk cohorts.
  - P0 hard gates use critical recall >= 0.95 with zero samples dropping any critical fact, important recall >= 0.85, weighted recall >= 0.90, schema-free major omission <= 0.10, real continuation first/critical action >= 0.95, no repeated work >= 0.98, contradictory action = 0, stale leakage = 0, and completion delta <= 0.08.
  - P0 deterministic continuation metrics are diagnostic-only: proxy rows and gates report NOT EXECUTED, proxy-only runs remain evidence-insufficient, and only a fully executed real continuation run can satisfy L3 evidence without relabeling the proxy as executed.
  - P0 summaries and reports expose mean, min, per-cohort metrics, and 95% confidence intervals; token savings and structured judge scores alone are never accepted as success evidence.
  - Compression ratio is reported as an advisory economics signal, not as a pass/fail fidelity gate.
  - CompressionArtifact v1 keeps schemaVersion 1 and continues to normalize/render legacy payloads that have no semanticAtoms.
  - semanticAtoms is optional and synchronized across agent-core, shared/host-api/contract.ts, Gateway CompressionArtifactSchema, and Electron sessions-api mapping.
  - A critical atom with no evidence refs is never presented as verified: agent-core and the Electron boundary downgrade it to unverified and add quality.warnings, while the Gateway schema rejects a critical verified atom with an empty evidenceRefs array.
  - Atom text stays bounded and redacted; large code, tool-schema, and durable-fact bodies are kept only as evidence refs plus a truncated projection.
  - Recovery projection exposes verified/unverified/stale/superseded/conflict counts without copying large atom bodies.
  - Consecutive compactions carry the previous normalized artifact and preserve superseded atoms instead of deleting them; conflicting atoms remain visible.
  - Legacy objective/decisions/failedAttempts/nextAction fields are generated from the atom ledger when atoms are present, and Markdown summary remains a projection.
  - P2 routes provider, built-in LLM, and no-real-conversation boundary compaction through one finalize pipeline; no provider trusted bypass remains.
  - P2 safeguard compaction writes details.artifact (schemaVersion 1) and details.validatedPipeline (shadow) on provider, LLM, and boundary exits.
  - P2 critical ledger and exact identifier omissions are recorded as deterministic shadow audit; wouldRetry/wouldFallback/wouldPreserveTurns are recorded and never enforce or alter the returned summary.
  - P2 adds no model calls beyond the existing bounded LLM qualityGuard retry, does not modify UI/E2E, and does not carry telemetry or CRK optional fields into the new safeguard artifact.
  - P3 auditCompactionAddressability is deterministic and fixture-covered: every critical atom resolves to archive, file, or CVK selector evidence, and session-only refs are never treated as addressable.
  - P3 binds checkpoint archive handles into details.artifact critical atom evidence before checkpoint persist; missing archive handles leave the artifact unchanged.
  - P3 missing or stale CVK selectors fail explicitly with missing_selector/stale_selector diagnostics; recovery keeps ok=false instead of silently trusting the ref.
  - P3 subsequent compaction uses buildPreviousCompactionLedgerMessage from previousArtifact.semanticAtoms plus current messages, and only falls back to previousSummary when no artifact ledger exists.
  - P3 stale branch atoms never become active nextAction, superseded decision atoms stay in the ledger as superseded and are not active, and failed actions are projected for recovery without being repeated.
  - P3 keeps legacy transcript replay as the rollback path and does not add model calls, judge calls, UI, or E2E changes.
  - P4 paired trajectory JSONL overlays compressed outputs with fullContextSuccess and compressedSuccess booleans; invalid or duplicate rows are recorded as diagnostics and never abort the run.
  - P4 classifies fullContextSuccess=true plus compressedSuccess=false as compression_induced_failure, and only those samples enter failure-driven critic and guideline building.
  - P4 DeepSeek critic is opt-in via --llm-critic; missing DEEPSEEK_API_KEY, invalid JSON, or no candidate failures produce explicit executed=false diagnostics, never fabricated critic output.
  - P4 failure guidelines are bounded, JSON-serializable, and written only with --write-failure-guidelines; guidelines never enter CompressionArtifact or runtime compaction paths.
  - P4 model independence is audited: compressor, judge, schema-free, continuation, and critic models are recorded; a compressor that reuses any judge/critic model is marked not independent.
  - P4 paired trajectory metrics report recall, omission, fabrication, continuation, retry rate, latency, token, and cost with mean/min/cohort/95% CI where available; token savings remain advisory only.
  - P5 critical-first budget order is deterministic and fixed as criticalLedger -> latestUserAsk -> unfinishedActions -> failureChainValidation -> exactIdentifiers -> importantFacts -> niceToHaveProse; niceToHaveProse truncates first and criticalLedger last.
  - P5 selectCompressionPlan accepts optional thresholds and only moves thresholds earlier with Math.min semantics; the 0.6/0.75/0.85/0.95 production ladder remains the hard backstop when thresholds are absent.
  - P5 planCompression accepts optional tierSchedule that only changes plan.tier; micro-compact, token-pruning, and emergency-collapse behavior stays identical to the existing implementation.
  - P5 writes A5 planAdoptedCount/planIgnoredCount/budgetExceededCount at the real embedded-compaction and safeguard compaction call sites; ignored rate > 20% triggers degrade_to_default_budget through the existing deprecation counters registry.
  - P5 budgetShadow is JSON-serializable diagnostics on CompactionDetails only; it never enters CompressionArtifact and CompressionArtifact.schemaVersion stays 1.
  - P5 nativeMemory/nativeContextGating negotiation is additive: absent declarations preserve current behavior, and negotiated channel closes use the existing recordContextOrchestratorSourceDecision provenance receipt.
  - P5 planner p99 stays <= 30ms and the A5+A1+A3 cumulative per-turn smoke p99 stays <= 300ms.
  - P6 promotion order is fixed as shadow -> would-retry -> provider-pressure-pilot -> critical-only -> limited; default shadow preserves P0-P5 behavior byte-for-byte.
  - P6 evaluateCompactionPromotionGate is a pure fail-closed evaluator that reports failing automated evidence instead of fabricating promotion; humanScoredSamples, humanRaters, and human-eval-pack are intentionally removed from P6 promotion and are never read, generated, or required.
  - P6-A fixed acceptance input is `reports/context-compression/production-manifest-30.json` plus `reports/context-compression/production-summaries-30-generated.jsonl`: 30 fixed production paired samples, `--no-cache`, real DeepSeek API execution.
  - P6-A model independence requires compressor=deepseek-chat and judge/schema-free/continuation/critic=deepseek-reasoner; modelIndependence.ok must be true.
  - P6-A automated release gates are: fixed production paired samples >= 30, modelIndependence.ok=true, critical dropped samples = 0, schema-free major/critical omission <= 0.10, real continuation critical action >= 0.95, stale leakage = 0, completion delta <= 0.08, and no fabrication >= 0.98; any failing gate keeps promotionStage at shadow.
  - P6-A formal full runs must pass `--full-real-min 30`, use a fixed manifest resolved at >=30 samples, disable cache, request judge/schema-free/real continuation for the complete sample set, and require model independence; generic full-suite default real minimum remains 100.
  - P6 would-retry is bounded and provider-only for new retry paths; LLM continues using the existing qualityGuard retries, boundary never enforces.
  - P6 would-retry canary repairs validate only the provider narrative against the same redacted evidence view sent to the provider, append the deterministic recovery ledger and authoritative continuation directive only after validation, and separately record bounded-request checks, final gate passes, and exhausted retry budgets; the shadow arm remains unchanged.
  - P6 would-retry treats actionable pending text as a repair reason when the deterministic continuation directive proves the latest outcome completed; it performs at most one provider retry, then removes only contradicted pending state from Goal/Attempts/Current State and normalizes Open TODOs/Pending user asks/Next Actions to None, while directives without a completed outcome leave real pending work unchanged.
  - P6 would-retry exact-identifier checks use a custom evidence-backed set derived from deterministic recovery facts and continuation action ids; the canary does not reuse the broad strict transcript scan, missing identifiers request at most one retry, and any residual omission is added only to the narrative Exact identifiers section with redaction preserved.
  - P6 would-retry repairs a retried provider narrative into the single HANDOFF_SECTIONS order only after the bounded retry is consumed; existing section content and supported provider aliases are preserved, missing sections receive evidence-limited placeholders, Next Actions points to the authoritative candidate id, and the shadow arm remains byte-for-byte unchanged.
  - P6 canary manifests use the eval runner's version-2 `sampleManifestKey` and transcript identity semantics (`pathHash`, basename, size, floor mtime); selected source/meta identity, selection hash, and current source fingerprint are fail-closed before any provider request.
  - P6 current-source deterministic recovery batches are model-free diagnostics only: they may prove L0/L1/L2 ledger retention, but `layer3Gate` remains `NOT EXECUTED` until real continuation evidence is present; identical-score calibration warnings remain visible.
  - P6 real-sample evaluation merges the same authoritative tail recovery window used by the runtime ledger, and deterministic L2 accepts canonical `Decisions`/`Constraints/Rules` plus supported historical aliases without weakening stale/fabrication gates.
  - P6 recovery semantics are expected-vs-failure qualified: disabled/unavailable feature status reports, runtime-held locked files, and objective-conditioned expected misses are classified `expected_behavior` and never promoted as open failures, `Inspect the product/code failure` follow-ups, or Current State blockers; loose success markers (for example the word `fixed` inside a `fixed-string scan` adjustment note) must not resolve an open failure.
  - P6 recovery semantics are terminal-state truthful: grep/scan verification narrations count as successful outcomes even when the same message recaps failure history; failures carrying or followed by verified completion are `resolved`-historical and must not drive Current State, derived next actions, or the continuation directive; summaries carry an `## Outcome Status` section, and a Done/Validated state must instruct not to redo completed work.
  - P6 evaluator and continuation directive must derive the same primary action: strict failure-after-outcome line ordering, a latest-outcome-guarded next-action, the preserve-outcome fallback, and the expected/resolved exclusions exist identically in both derivations; `scripts/context-compression-semantic-audit.mjs` fails closed when the two sides drift.
  - P6 judge prompts must show the transcript excerpt as head plus authoritative tail (schema-free omission v4 or later) — head-only excerpts make the judge mistake legitimate tail-derived summary content for a different session; continuation prompts (v5 or later) must require at least one returned action so completed-task preserve-outcome decisions are never scored as empty-action misses.
  - P6 critical-only and limited enforce by cancelling real provider/LLM compactions only when validatedPipeline.wouldPreserveTurns is true; boundary remains non-enforcing.
  - P6 promotionStage is config/runtime additive plumbing with default shadow; no stage means no behavior change.
  - TF-0076 uses the written cost budget in reports/context-compression/TF0076-COST-BUDGET-2026-09-15.md: paired actual total tokens <= 1.20x shadow, mean end-to-end latency <= 1.50x shadow, and at most one added provider retry per sample. Missing current-source paired evidence cannot pass; historical reports may support NO-GO but cannot be re-signed as a current success.
  - TF-0076 may close with an explicit cost NO-GO only after all required engineering tests pass on one clean scoped candidate with HEAD/tree/manifest identity. Task completion does not authorize promotion, default-on, liveReady, or productApproved; extra retry triggers must fit the same total cost budget before adoption.
  - P6 Runtime checks select the existing unit, unit-fast, and agents configs explicitly and verify that every declared test file actually executes. A green subset or an empty project is not complete coverage of the required file list.
docs:
  required: true
  files:
    - reports/context-compression/TF0076-COST-BUDGET-2026-09-15.md
    - docs/clawx-design-overview.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

`CompressionArtifact v1` is a recovery carrier, not a proof of task completion. Task Ledger, ClawGraph handoffs, and observability remain the authoritative evidence layers for durable long-task truth.
